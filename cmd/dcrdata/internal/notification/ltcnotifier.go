// Copyright (c) 2018-2021, The Decred developers
// Copyright (c) 2017, Jonathan Chappelow
// See LICENSE for details.

// Package notification synchronizes dcrd notifications to any number of
// handlers. Typical use:
//  1. Create a Notifier with NewNotifier.
//  2. Grab dcrd configuration settings with DcrdHandlers.
//  3. Create an dcrd/rpcclient.Client with the settings from step 2.
//  4. Add handlers with the Register*Group methods. You can add more than
//     one handler (a "group") at a time. Groups are run sequentially in the
//     order that they are registered, but the handlers within a group are run
//     asynchronously.
//  5. Set the previous best known block with SetPreviousBlock. By this point,
//     it should be certain that all of the data consumers are synced to the best
//     block.
//  6. **After all handlers have been added**, start the Notifier with Listen,
//     providing as an argument the dcrd client created in step 3.
package notification

import (
	"context"
	"sync"
	"time"

	"github.com/decred/dcrdata/v8/mutilchain"
	"github.com/ltcsuite/ltcd/btcjson"
	"github.com/ltcsuite/ltcd/chaincfg/chainhash"
	"github.com/ltcsuite/ltcd/rpcclient"
)

// TxHandler is a function that will be called when dcrd reports new mempool
// transactions.
type LtcTxHandler func(*btcjson.TxRawResult) error

// BlockHandler is a function that will be called when dcrd reports a new block.
type LtcBlockHandler func(*mutilchain.LtcBlockHeader) error

// BlockHandlerLite is a simpler trigger using only bultin types, also called
// when dcrd reports a new block.
type LtcBlockHandlerLite func(uint32, string) error

// Notifier handles block, tx, and reorg notifications from a dcrd node. Handler
// functions are registered with the Register*Handlers methods. To start the
// Notifier, Listen must be called with a dcrd rpcclient.Client only after all
// handlers are registered.
type LTCNotifier struct {
	node LTCDNode
	// The anyQ sequences all dcrd notification in the order they are received.
	anyQ     chan interface{}
	tx       [][]LtcTxHandler
	block    [][]LtcBlockHandler
	previous struct {
		hash   chainhash.Hash
		height uint32
	}
}

// NewNotifier is the constructor for a Notifier.
func NewLtcNotifier() *LTCNotifier {
	return &LTCNotifier{
		// anyQ can cause deadlocks if it gets full. All mempool transactions pass
		// through here, so the size should stay pretty big to accommodate for the
		// inevitable explosive growth of the network.
		anyQ:  make(chan interface{}, 1024),
		tx:    make([][]LtcTxHandler, 0),
		block: make([][]LtcBlockHandler, 0),
	}
}

// DCRDNode is an interface to wrap a dcrd rpcclient.Client. The interface
// allows testing with a dummy node.
type LTCDNode interface {
	NotifyBlocks() error
	NotifyNewTransactions(bool) error
}

// Listen must be called once, but only after all handlers are registered.
func (notifier *LTCNotifier) Listen(ctx context.Context, ltcdClient LTCDNode) *ContextualError {
	// Register for block connection and chain reorg notifications.
	notifier.node = ltcdClient

	var err error
	if err = ltcdClient.NotifyBlocks(); err != nil {
		return newContextualError("block notification "+
			"registration failed", err)
	}

	// Register for tx accepted into mempool ntfns
	if err = ltcdClient.NotifyNewTransactions(true); err != nil {
		return newContextualError("new transaction verbose notification registration failed", err)
	}

	go notifier.superQueue(ctx)
	return nil
}

// DcrdHandlers creates a set of handlers to be passed to the dcrd
// rpcclient.Client as a parameter of its constructor.
func (notifier *LTCNotifier) LtcdHandlers() *rpcclient.NotificationHandlers {
	return &rpcclient.NotificationHandlers{
		OnBlockConnected:    notifier.onBlockConnected,
		OnBlockDisconnected: notifier.onBlockDisconnected,
		// OnTxAcceptedVerbose is invoked same as OnTxAccepted but is used here
		// for the mempool monitors to avoid an extra call to dcrd for
		// the tx details
		OnTxAcceptedVerbose: notifier.onTxAcceptedVerbose,
	}
}

// superQueue should be run as a goroutine. The dcrd-registered block and reorg
// handlers should perform any pre-processing and type conversion and then
// deposit the payload into the anyQ channel.
func (notifier *LTCNotifier) superQueue(ctx context.Context) {
out:
	for {
		select {
		case rawMsg := <-notifier.anyQ:
			// Do not allow new blocks to process while running reorg. Only allow
			// them to be processed after this reorg completes.
			switch msg := rawMsg.(type) {
			case *mutilchain.LtcBlockHeader:
				// Process the new block.
				log.Infof("LTCSuperQueue: Processing new block %v. Height: %d", msg.Hash, msg.Height)
				notifier.processBlock(msg)
			case *btcjson.TxRawResult:
				notifier.processTx(msg)
			default:
				log.Warn("unknown message type in superQueue LTC: %T", rawMsg)
			}
		case <-ctx.Done():
			break out
		}
	}
}

func (notifier *LTCNotifier) SetPreviousBlock(prevHash chainhash.Hash, prevHeight uint32) {
	notifier.previous.hash = prevHash
	notifier.previous.height = prevHeight
}

// rpcclient.NotificationHandlers.OnBlockConnected
// TODO: considering using txns [][]byte to save on downstream RPCs.
func (notifier *LTCNotifier) onBlockConnected(hash *chainhash.Hash, height int32, t time.Time) {
	blockHeader := &mutilchain.LtcBlockHeader{
		Hash:   *hash,
		Height: height,
		Time:   t,
	}

	log.Debugf("OnBlockConnected: %d / %v", height, hash)

	notifier.anyQ <- blockHeader
}

// rpcclient.NotificationHandlers.OnBlockDisconnected
func (notifier *LTCNotifier) onBlockDisconnected(hash *chainhash.Hash, height int32, t time.Time) {
	log.Debugf("OnBlockDisconnected: %d / %v", height, hash)
}

// rpcclient.NotificationHandlers.OnTxAcceptedVerbose
func (notifier *LTCNotifier) onTxAcceptedVerbose(tx *btcjson.TxRawResult) {
	// Current UNIX time to assign the new transaction.
	tx.Time = time.Now().Unix()
	notifier.anyQ <- tx
}

// RegisterTxHandlerGroup adds a group of tx handlers. Groups are run
// sequentially in the order they are registered, but the handlers within the
// group are run asynchronously.
func (notifier *LTCNotifier) RegisterTxHandlerGroup(handlers ...LtcTxHandler) {
	notifier.tx = append(notifier.tx, handlers)
}

// RegisterBlockHandlerGroup adds a group of block handlers. Groups are run
// sequentially in the order they are registered, but the handlers within the
// group are run asynchronously. Handlers registered with
// RegisterBlockHandlerGroup are FIFO'd together with handlers registered with
// RegisterBlockHandlerLiteGroup.
func (notifier *LTCNotifier) RegisterBlockHandlerGroup(handlers ...LtcBlockHandler) {
	notifier.block = append(notifier.block, handlers)
}

// RegisterBlockHandlerLiteGroup adds a group of block handlers. Groups are run
// sequentially in the order they are registered, but the handlers within the
// group are run asynchronously. This method differs from
// RegisterBlockHandlerGroup in that the handlers take no arguments, so their
// packages don't necessarily need to import dcrd/wire. Handlers registered with
// RegisterBlockHandlerLiteGroup are FIFO'd together with handlers registered
// with RegisterBlockHandlerGroup.
func (notifier *LTCNotifier) RegisterBlockHandlerLiteGroup(handlers ...LtcBlockHandlerLite) {
	translations := make([]LtcBlockHandler, 0, len(handlers))
	// for i := range handlers {
	// 	handler := handlers[i]
	// 	translations = append(translations, func(block *wire.BlockHeader) error {
	// 		return handler(block., block.BlockHash().String())
	// 	})
	// }
	notifier.RegisterBlockHandlerGroup(translations...)
}

// processBlock calls the BlockHandler/BlockHandlerLite groups one at a time in
// the order that they were registered.
func (notifier *LTCNotifier) processBlock(bh *mutilchain.LtcBlockHeader) {
	start := time.Now()
	for _, handlers := range notifier.block {
		wg := new(sync.WaitGroup)
		for _, h := range handlers {
			wg.Add(1)
			go func(h LtcBlockHandler) {
				tStart := time.Now()
				defer wg.Done()
				defer log.Tracef("Notifier: BlockHandler %s completed in %v",
					functionName(h), time.Since(tStart))
				if err := h(bh); err != nil {
					log.Errorf("block handler failed: %v", err)
					return
				}
			}(h)
		}
		done := make(chan struct{})
		go func() {
			wg.Wait()
			close(done)
		}()
		select {
		case <-done:
		case <-time.NewTimer(SyncHandlerDeadline).C:
			log.Errorf("at least 1 block handler has not completed before the deadline")
			return
		}
	}
	log.Debugf("handlers of Notifier.processBlock() completed in %v", time.Since(start))
}

// processTx calls the TxHandler groups one at a time in the order that they
// were registered.
func (notifier *LTCNotifier) processTx(tx *btcjson.TxRawResult) {
	start := time.Now()
	for i, handlers := range notifier.tx {
		wg := new(sync.WaitGroup)
		for j, h := range handlers {
			wg.Add(1)
			go func(h LtcTxHandler, i, j int) {
				defer wg.Done()
				defer log.Tracef("Notifier: TxHandler %d.%d completed", i, j)
				if err := h(tx); err != nil {
					log.Errorf("tx handler failed: %v", err)
					return
				}
			}(h, i, j)
		}
		done := make(chan struct{})
		go func() {
			wg.Wait()
			close(done)
		}()
		select {
		case <-done:
		case <-time.NewTimer(SyncHandlerDeadline).C:
			log.Errorf("at least 1 tx handler has not completed before the deadline")
			return
		}
	}
	log.Tracef("handlers of Notifier.onTxAcceptedVerbose() completed in %v", time.Since(start))
}
