// Copyright (c) 2018-2021, The Decred developers
// Copyright (c) 2017, Jonathan Chappelow
// See LICENSE for details.

package blockdataxmr

import (
	"context"
	"fmt"
	"reflect"
	"sync"
	"time"

	"github.com/decred/dcrdata/v8/xmr/xmrutil"
)

// for getblock, ticketfeeinfo, estimatestakediff, etc.
type chainMonitor struct {
	ctx        context.Context
	collector  *Collector
	dataSavers []BlockDataSaver
	storeLock  sync.Mutex
}

// NewChainMonitor creates a new chainMonitor.
func NewChainMonitor(ctx context.Context, collector *Collector,
	savers []BlockDataSaver) *chainMonitor {
	return &chainMonitor{
		ctx:        ctx,
		collector:  collector,
		dataSavers: savers,
	}
}

func (p *chainMonitor) collect(height uint64) (*xmrutil.BlockData, error) {
	// Lấy block info
	blockData, err := p.collector.CollectHeight(height)
	if err != nil {
		return nil, fmt.Errorf("failed to collect block at height %d: %v", height, err)
	}

	log.Infof("Block height %d connected. Collecting data...", height)

	return blockData, nil
}

type XmrBlockHeader struct {
	Height uint64
	Hash   string
}

func (p *chainMonitor) ConnectBlock(header *XmrBlockHeader) error {
	// Do not handle reorg and block connects simultaneously.
	p.storeLock.Lock()
	defer p.storeLock.Unlock()

	// Collect block data.
	blockData, err := p.collect(header.Height)
	if err != nil {
		return err
	}

	// Store block data with each saver.
	for _, s := range p.dataSavers {
		if s != nil {
			tStart := time.Now()
			if err0 := s.XMRStore(blockData); err0 != nil {
				log.Errorf("(%v).XMRStore failed: %v", reflect.TypeOf(s), err0)
				err = err0
			}
			log.Tracef("XMR: chainMonitor.ConnectBlock: Completed %s.XMRStore in %v.",
				reflect.TypeOf(s), time.Since(tStart))
		}
	}
	return err
}
