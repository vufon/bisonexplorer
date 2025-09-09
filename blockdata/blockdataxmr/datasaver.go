// Copyright (c) 2020, The Decred developers
// Copyright (c) 2017, Jonathan Chappelow
// See LICENSE for details.

// Interface for saving/storing BlockData.
// Create a BlockDataSaver by implementing Store(*BlockData).

package blockdataxmr

import "github.com/decred/dcrdata/v8/xmr/xmrutil"

// BlockDataSaver is an interface for saving/storing BlockData
type BlockDataSaver interface {
	XMRStore(blockData *xmrutil.BlockData) error
}

// BlockTrigger wraps a simple function of builtin-typed hash and height.
type BlockTrigger struct {
	Async bool
	Saver func(string, uint32) error
}

// Store reduces the block data to the hash and height in builtin types,
// and passes the data to the saver.
func (s BlockTrigger) XMRStore(bd *xmrutil.BlockData) error {
	if s.Async {
		go func() {
			err := s.Saver(bd.Header.Hash, uint32(bd.Header.Height))
			if err != nil {
				log.Errorf("XMR: BlockTrigger: Saver failed: %v", err)
			}
		}()
		return nil
	}
	return s.Saver(bd.Header.Hash, uint32(bd.Header.Height))
}
