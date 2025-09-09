// Copyright (c) 2020-2021, The Decred developers
// Copyright (c) 2017, Jonathan Chappelow
// See LICENSE for details.

package blockdataxmr

import (
	"fmt"
	"sync"

	"github.com/decred/dcrdata/v8/xmr/xmrutil"
)

type NodeClient interface {
	GetBlockCount() (uint64, error)
	GetBlockHeaderByHeight(height uint64) (*xmrutil.BlockHeader, error)
	GetBlockHeaderByHash(hash string) (*xmrutil.BlockHeader, error)
	GetBlock(height uint64) (*xmrutil.BlockResult, error)
	GetBlockByHash(hash string) (*xmrutil.BlockResult, error)
	GetInfo() (*xmrutil.BlockchainInfo, error)
	GetConnections() (int, error)
	GetLastBlockHeader() (*xmrutil.BlockHeader, error)
}

type Collector struct {
	mtx    sync.Mutex
	xmrRPC NodeClient
}

func NewCollector(xmrRPC NodeClient) *Collector {
	return &Collector{xmrRPC: xmrRPC}
}

func (c *Collector) CollectHeight(height uint64) (*xmrutil.BlockData, error) {
	c.mtx.Lock()
	defer c.mtx.Unlock()

	header, err := c.xmrRPC.GetBlockHeaderByHeight(height)
	if err != nil {
		return nil, err
	}

	block, err := c.xmrRPC.GetBlock(height)
	if err != nil {
		return nil, err
	}

	info, _ := c.xmrRPC.GetInfo()
	conns, _ := c.xmrRPC.GetConnections()
	blockData := xmrutil.BlockData{
		Header:         *header,
		Connections:    conns,
		BlockchainInfo: *info,
		ExtraInfo: xmrutil.ExtraInfo{
			TxLen: len(block.TxHashes),
		},
		TxHashes: block.TxHashes,
	}
	return &blockData, nil
}

func (c *Collector) CollectHash(hash string) (*xmrutil.BlockData, error) {
	c.mtx.Lock()
	defer c.mtx.Unlock()

	header, err := c.xmrRPC.GetBlockHeaderByHash(hash)
	if err != nil {
		return nil, err
	}

	block, err := c.xmrRPC.GetBlockByHash(hash)
	if err != nil {
		return nil, err
	}

	info, _ := c.xmrRPC.GetInfo()
	conns, _ := c.xmrRPC.GetConnections()
	blockData := xmrutil.BlockData{
		Header:         *header,
		Connections:    conns,
		BlockchainInfo: *info,
		ExtraInfo: xmrutil.ExtraInfo{
			TxLen: len(block.TxHashes),
		},
		TxHashes: block.TxHashes,
	}
	return &blockData, nil
}

func (c *Collector) CollectBest() (*xmrutil.BlockData, error) {
	header, err := c.xmrRPC.GetLastBlockHeader()
	if err != nil {
		return nil, fmt.Errorf("get_last_block_header failed: %v", err)
	}
	return c.CollectHeight(header.Height)
}
