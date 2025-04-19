package externalapi

import (
	"fmt"
	"net/http"

	"github.com/btcsuite/btcd/btcutil"
	"github.com/decred/dcrdata/v8/db/dbtypes"
)

var memSpaceBlocksURL = "https://mempool.space/api/v1/blocks/%d"
var memSpacePoolsURL = "https://mempool.space/api/v1/mining/pools/24h"

type MultichainBlocks struct {
	ID           string      `json:"id"`
	Timestamp    int64       `json:"timestamp"`
	Height       int64       `json:"height"`
	Nonce        uint32      `json:"nonce"`
	Difficulty   float64     `json:"difficulty"`
	MerkleRoot   string      `json:"merkle_root"`
	PreviousHash string      `json:"previousblockhash"`
	Extras       BlockExtras `json:"extras"`
}

type BlockExtras struct {
	CoinbaseRaw string         `json:"coinbaseRaw"`
	Reward      int64          `json:"reward"`
	Pool        MultichainPool `json:"pool"`
}

type MultichainPool struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
	Slug string `json:"slug"`
}

type MiningPoolsResponse struct {
	Pools                 []MiningPool `json:"pools"`
	BlockCount            int          `json:"blockCount"`
	LastEstimatedHashrate float64      `json:"lastEstimatedHashrate"`
}

type MiningPool struct {
	PoolID      int    `json:"poolId"`
	Name        string `json:"name"`
	Link        string `json:"link"`
	BlockCount  int    `json:"blockCount"`
	Rank        int    `json:"rank"`
	EmptyBlocks int    `json:"emptyBlocks"`
	Slug        string `json:"slug"`
}

func GetBitcoinLastBlocksPool(startHeight int64) ([]*dbtypes.MultichainPoolDataItem, error) {
	url := fmt.Sprintf(memSpaceBlocksURL, startHeight)
	// get last 15 blocks
	var blocks []MultichainBlocks
	req := &ReqConfig{
		Method:  http.MethodGet,
		HttpUrl: url,
		Payload: map[string]string{},
	}
	if err := HttpRequest(req, &blocks); err != nil {
		return nil, err
	}
	// get last 24h pools
	var pools MiningPoolsResponse
	req = &ReqConfig{
		Method:  http.MethodGet,
		HttpUrl: memSpacePoolsURL,
		Payload: map[string]string{},
	}
	if err := HttpRequest(req, &pools); err != nil {
		return nil, err
	}
	// get last 5 blocks
	result := make([]*dbtypes.MultichainPoolDataItem, 0)
	for i := 0; i < 10; i++ {
		block := blocks[i]
		poolData := dbtypes.MultichainPoolDataItem{
			BlockHeight: block.Height,
			PoolName:    block.Extras.Pool.Name,
			PoolSlug:    block.Extras.Pool.Slug,
			Reward:      btcutil.Amount(block.Extras.Reward).ToBTC(),
		}
		// get pools from list
		for _, pool := range pools.Pools {
			if pool.Slug == poolData.PoolSlug {
				poolData.Link = pool.Link
				poolData.Pool24hBlocks = pool.BlockCount
				poolData.Health = float64(pool.BlockCount-pool.EmptyBlocks) / float64(pool.BlockCount)
				break
			}
		}
		result = append(result, &poolData)
	}
	return result, nil
}
