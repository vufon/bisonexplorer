package externalapi

import (
	"fmt"
	"net/http"

	"github.com/btcsuite/btcd/btcutil"
	"github.com/decred/dcrdata/v8/db/dbtypes"
)

var litecoinSpaceBlocksURL = "https://litecoinspace.org/api/v1/blocks/%d"
var litecoinSpacePoolsURL = "https://litecoinspace.org/api/v1/mining/pools/24h"

func GetLitecoinLastBlocksPool(startHeight int64) ([]*dbtypes.MultichainPoolDataItem, error) {
	url := fmt.Sprintf(litecoinSpaceBlocksURL, startHeight)
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
		HttpUrl: litecoinSpacePoolsURL,
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
