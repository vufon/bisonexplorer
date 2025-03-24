package externalapi

import (
	"log"
	"net/http"

	"github.com/decred/dcrdata/v8/db/dbtypes"
)

const (
	THREEPOOL   = "threepool"
	MININGANDCO = "miningandco"
	E4POOL      = "e4pool"
)

var threePoolURL = `https://dcr.threepool.tech/blocks`
var e4poolURL = `https://dcr.e4pool.com/blocks`
var miningandcoURL = `https://decred.miningandco.com/blocks`

type PoolResponse struct {
	Data []*dbtypes.PoolDataItem `json:"data"`
}

func GetPoolData(poolURL string) ([]*dbtypes.PoolDataItem, error) {
	query := map[string]string{
		"pageSize":   "5",
		"pageNumber": "1",
	}
	req := &ReqConfig{
		Method:  http.MethodGet,
		HttpUrl: poolURL,
		Payload: query,
	}
	var responseData PoolResponse
	if err := SkipTLSHttpRequest(req, &responseData); err != nil {
		return nil, err
	}
	return responseData.Data, nil
}

func GetLastBlocksPool(bestBlockHeight int64) ([]*dbtypes.PoolDataItem, error) {
	log.Printf("Start handler get pool info API")
	result := make([]*dbtypes.PoolDataItem, 0)
	count := 0
	// get from threepool
	threepoolRes, err := GetPoolData(threePoolURL)
	if err != nil {
		return nil, err
	}
	completed := false
	for _, pool := range threepoolRes {
		if count == 5 {
			completed = true
			break
		}
		if pool.BlockHeight <= bestBlockHeight && pool.BlockHeight > bestBlockHeight-5 {
			count++
			pool.PoolType = THREEPOOL
			result = append(result, pool)
		}
	}
	if completed {
		log.Printf("Finished handler get pool info API")
		return result, nil
	}

	// get from e4pool
	e4poolRes, err := GetPoolData(e4poolURL)
	if err != nil {
		return nil, err
	}

	for _, pool := range e4poolRes {
		if count == 5 {
			completed = true
			break
		}
		if pool.BlockHeight <= bestBlockHeight && pool.BlockHeight > bestBlockHeight-5 {
			count++
			pool.PoolType = E4POOL
			result = append(result, pool)
		}
	}
	if completed {
		log.Printf("Finished handler get pool info API")
		return result, nil
	}

	// Get from miningandco
	miningandcoRes, err := GetPoolData(miningandcoURL)
	if err != nil {
		return nil, err
	}

	for _, pool := range miningandcoRes {
		if count == 5 {
			completed = true
			break
		}
		if pool.BlockHeight <= bestBlockHeight && pool.BlockHeight > bestBlockHeight-5 {
			count++
			pool.PoolType = MININGANDCO
			result = append(result, pool)
		}
	}
	log.Printf("Finished handler get pool info API")
	return result, nil
}
