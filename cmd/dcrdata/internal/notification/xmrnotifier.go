package notification

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/decred/dcrdata/v8/blockdata/blockdataxmr"
	"github.com/decred/dcrdata/v8/xmr/xmrclient"
)

// ---------- Notifier Types ----------

type XmrBlockHandler func(*blockdataxmr.XmrBlockHeader) error

type NewBlock struct {
	Height   uint64
	Hash     string
	TxHashes []string
}

type XmrNotifier struct {
	client     *xmrclient.XMRClient
	Endpoint   string
	Interval   time.Duration
	LastHeight uint64

	// Channels public
	NewBlocks chan NewBlock
	NewTxs    chan string

	// handlers grouped
	block [][]XmrBlockHandler

	// internal mutex to protect LastHeight
	mtx sync.Mutex
}

// NewXmrNotifier creates a notifier. It does NOT contact the daemon.
// Use Start or StartFromHeight to actually begin polling.
func NewXmrNotifier(endpoint string, interval time.Duration) *XmrNotifier {
	return &XmrNotifier{
		Endpoint:   endpoint,
		Interval:   interval,
		LastHeight: 0,
		NewBlocks:  make(chan NewBlock, 500),
		NewTxs:     make(chan string, 2000),
		block:      make([][]XmrBlockHandler, 0),
	}
}

// RegisterBlockHandlerGroup registers a group of handlers that will be executed
// concurrently for each block (group ordering preserved).
func (n *XmrNotifier) RegisterBlockHandlerGroup(handlers ...XmrBlockHandler) {
	n.block = append(n.block, handlers)
}

// ---------------------- Start helpers ----------------------

// Start begins polling the daemon for new blocks, starting from the current tip.
// It will set LastHeight = tipHeight (so it will only deliver blocks mined after Start).
func (n *XmrNotifier) Start(ctx context.Context, client *xmrclient.XMRClient) error {
	return n.startInternal(ctx, client, "tip", 0)
}

// StartFromHeight begins polling starting from an explicit height (inclusive).
// If you pass startHeight = 0 it will process from genesis (careful).
func (n *XmrNotifier) StartFromHeight(ctx context.Context, client *xmrclient.XMRClient, startHeight uint64) error {
	return n.startInternal(ctx, client, "fromheight", startHeight)
}

// internal start implementation
func (n *XmrNotifier) startInternal(ctx context.Context, client *xmrclient.XMRClient, mode string, startHeight uint64) error {
	if client == nil {
		return fmt.Errorf("xmr client is nil")
	}
	n.client = client

	// Determine starting LastHeight based on mode.
	switch mode {
	case "tip":
		hdr, err := client.GetLastBlockHeader()
		if err != nil {
			return fmt.Errorf("XMR: Start: GetLastBlockHeader failed: %v", err)
		}
		// set LastHeight to tip; we will only process blocks with height > LastHeight
		n.setLastHeight(hdr.Height)
		log.Infof("XmrNotifier: starting at tip height %d (will process new blocks only)", hdr.Height)
	case "fromheight":
		n.setLastHeight(startHeight - 1) // so first processed is startHeight
		log.Infof("XmrNotifier: starting from height %d", startHeight)
	default:
		return fmt.Errorf("XMR: unknown start mode: %s", mode)
	}

	ticker := time.NewTicker(n.Interval)

	// polling goroutine
	go func() {
		defer func() {
			if r := recover(); r != nil {
				fmt.Printf("XmrNotifier recovered from panic: %v\n", r)
			}
		}()
		for {
			select {
			case <-ctx.Done():
				fmt.Println("XMR notifier polling stopped")
				ticker.Stop()
				return
			case <-ticker.C:
				// get stable tip via get_last_block_header
				hdr, err := client.GetLastBlockHeader()
				if err != nil {
					fmt.Printf("XmrNotifier: GetLastBlockHeader error: %v\n", err)
					continue
				}
				tip := hdr.Height

				last := n.getLastHeight()
				if tip <= last {
					// nothing new
					continue
				}

				// iterate from last+1 .. tip
				for h := last + 1; h <= tip; h++ {
					// be responsive to ctx cancellation in long loops
					select {
					case <-ctx.Done():
						fmt.Println("XMR notifier polling stopped (during block loop)")
						return
					default:
					}

					// fetch block data
					br, err := client.GetBlock(h)
					if err != nil {
						// it's possible tip changed between requests; break and retry next tick
						fmt.Printf("XmrNotifier: GetBlock(%d) error: %v; breaking loop to retry next tick\n", h, err)
						break
					}
					// get header for hash (to be safe)
					hdrByH, err := client.GetBlockHeaderByHeight(h)
					if err != nil {
						fmt.Printf("XmrNotifier: GetBlockHeaderByHeight(%d) error: %v; breaking\n", h, err)
						break
					}

					// merge miner tx and tx_hashes
					allTxs := make([]string, 0, 1+len(br.TxHashes))
					if br.MinerTxHash != "" {
						allTxs = append(allTxs, br.MinerTxHash)
					}
					allTxs = append(allTxs, br.TxHashes...)

					blk := NewBlock{
						Height:   hdrByH.Height,
						Hash:     hdrByH.Hash,
						TxHashes: allTxs,
					}

					// send block (respect context)
					select {
					case <-ctx.Done():
						return
					case n.NewBlocks <- blk:
					}

					// send txs (non-blocking but responsive to ctx)
					for _, tx := range blk.TxHashes {
						select {
						case <-ctx.Done():
							return
						case n.NewTxs <- tx:
						case <-time.After(200 * time.Millisecond):
							// if consumer slow, skip after small wait to avoid blocking forever
							log.Infof("XmrNotifier: skipping tx enqueue for tx %s due to slow consumer", tx)
						}
					}

					// update last processed height
					n.setLastHeight(h)
				}
			}
		}
	}()

	return nil
}

// getLastHeight returns LastHeight under lock.
func (n *XmrNotifier) getLastHeight() uint64 {
	n.mtx.Lock()
	defer n.mtx.Unlock()
	return n.LastHeight
}

// setLastHeight sets LastHeight under lock.
func (n *XmrNotifier) setLastHeight(h uint64) {
	n.mtx.Lock()
	n.LastHeight = h
	n.mtx.Unlock()
}

// ---------------------- Listen / Process ----------------------

// Listen starts a goroutine that consumes NewBlocks and executes handlers.
// It returns immediately. Use ctx to cancel.
func (n *XmrNotifier) Listen(ctx context.Context) error {
	if n.client == nil {
		return fmt.Errorf("Listen: xmr client not set; call Start(ctx, client) first")
	}

	go func() {
		for {
			select {
			case <-ctx.Done():
				log.Infof("XMR notifier stopped Listen()")
				return
			case blk := <-n.NewBlocks:
				log.Infof("XMR: Processing new block %v. Height: %d", blk.Hash, blk.Height)
				// process synchronously (processBlock will run handler groups concurrently)
				n.processBlock(&blockdataxmr.XmrBlockHeader{
					Height: blk.Height,
					Hash:   blk.Hash,
				})
			}
		}
	}()
	return nil
}

// processBlock executes registered handler groups. Each group runs handlers concurrently,
// groups are processed in order. Waits for each group with SyncHandlerDeadline.
func (notifier *XmrNotifier) processBlock(bh *blockdataxmr.XmrBlockHeader) {
	start := time.Now()
	for _, handlers := range notifier.block {
		wg := new(sync.WaitGroup)
		for _, h := range handlers {
			wg.Add(1)
			go func(h XmrBlockHandler) {
				defer wg.Done()
				t0 := time.Now()
				if err := h(bh); err != nil {
					log.Errorf("XMR: block handler failed: Height: %d. Error: %v", bh.Height, err)
				}
				log.Infof("XMR: handler block completed in %v. Height: %d", time.Since(t0), bh.Height)
			}(h)
		}

		done := make(chan struct{})
		go func() {
			wg.Wait()
			close(done)
		}()

		select {
		case <-done:
			// ok
		case <-time.After(SyncHandlerDeadline):
			log.Warnf("XMR: at least one block handler did not complete before deadline (%v). Height: %d", SyncHandlerDeadline, bh.Height)
			// continue to next group (or return, depending on desired behavior)
			// Here we return to avoid inconsistent state.
			return
		}
	}
	log.Infof("XMR: handlers of Notifier.processBlock() completed in %v. Height: %d", time.Since(start), bh.Height)
}
