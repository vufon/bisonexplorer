package externalapi

import (
	"fmt"
	"net/http"
)

var chainMap = map[string]string{
	"btc": "bitcoin",
	"ltc": "litecoin",
}

var blockchairChainStatsURL = "https://api.blockchair.com/%s/stats"

type BlockchairChainStatsApiResponse struct {
	Data    ChainStatsData `json:"data"`
	Context Context        `json:"context"`
}

type ChainStatsData struct {
	Blocks                            int64         `json:"blocks"`
	Transactions                      int64         `json:"transactions"`
	Outputs                           int64         `json:"outputs"`
	Circulation                       int64         `json:"circulation"`
	Blocks24h                         int64         `json:"blocks_24h"`
	Transactions24h                   int64         `json:"transactions_24h"`
	Difficulty                        float64       `json:"difficulty"`
	Volume24h                         int64         `json:"volume_24h"`
	MempoolTransactions               int64         `json:"mempool_transactions"`
	MempoolSize                       int64         `json:"mempool_size"`
	MempoolTps                        float64       `json:"mempool_tps"`
	MempoolTotalFeeUSD                float64       `json:"mempool_total_fee_usd"`
	BestBlockHeight                   int64         `json:"best_block_height"`
	BestBlockHash                     string        `json:"best_block_hash"`
	BestBlockTime                     string        `json:"best_block_time"`
	BlockchainSize                    int64         `json:"blockchain_size"`
	AverageTransactionFee24h          int64         `json:"average_transaction_fee_24h"`
	Inflation24h                      int64         `json:"inflation_24h"`
	MedianTransactionFee24h           int64         `json:"median_transaction_fee_24h"`
	CDD24h                            float64       `json:"cdd_24h"`
	MempoolOutputs                    int64         `json:"mempool_outputs"`
	LargestTransaction24h             LargestTx     `json:"largest_transaction_24h"`
	Nodes                             int64         `json:"nodes"`
	Hashrate24h                       string        `json:"hashrate_24h"`
	InflationUsd24h                   float64       `json:"inflation_usd_24h"`
	AverageTransactionFeeUsd24h       float64       `json:"average_transaction_fee_usd_24h"`
	MedianTransactionFeeUsd24h        float64       `json:"median_transaction_fee_usd_24h"`
	MarketPriceUsd                    float64       `json:"market_price_usd"`
	MarketPriceBtc                    float64       `json:"market_price_btc"`
	MarketPriceUsdChange24hPercentage float64       `json:"market_price_usd_change_24h_percentage"`
	MarketCapUsd                      int64         `json:"market_cap_usd"`
	MarketDominancePercentage         float64       `json:"market_dominance_percentage"`
	NextRetargetTimeEstimate          string        `json:"next_retarget_time_estimate"`
	NextDifficultyEstimate            float64       `json:"next_difficulty_estimate"`
	Countdowns                        []interface{} `json:"countdowns"`
	SuggestedTransactionFeePerByteSat int64         `json:"suggested_transaction_fee_per_byte_sat"`
	HodlingAddresses                  int64         `json:"hodling_addresses"`
}

type LargestTx struct {
	Hash     string  `json:"hash"`
	ValueUSD float64 `json:"value_usd"`
}

type Context struct {
	Code           int     `json:"code"`
	Source         string  `json:"source"`
	State          int64   `json:"state"`
	MarketPriceUsd float64 `json:"market_price_usd"`
	Cache          Cache   `json:"cache"`
	API            APIInfo `json:"api"`
	Servers        string  `json:"servers"`
	Time           float64 `json:"time"`
	RenderTime     float64 `json:"render_time"`
	FullTime       float64 `json:"full_time"`
	RequestCost    int     `json:"request_cost"`
}

type Cache struct {
	Live     bool    `json:"live"`
	Duration string  `json:"duration"`
	Since    string  `json:"since"`
	Until    string  `json:"until"`
	Time     float64 `json:"time"`
}

type APIInfo struct {
	Version         string `json:"version"`
	LastMajorUpdate string `json:"last_major_update"`
	NextMajorUpdate string `json:"next_major_update"`
	Documentation   string `json:"documentation"`
	Notice          string `json:"notice"`
}

func GetBlockchainStats(chainType string) (*ChainStatsData, error) {
	chainName, exist := chainMap[chainType]
	if !exist {
		return nil, fmt.Errorf("chain type is invalid")
	}
	url := fmt.Sprintf(blockchairChainStatsURL, chainName)
	req := &ReqConfig{
		Method:  http.MethodGet,
		HttpUrl: url,
		Payload: map[string]string{},
	}
	var responseData BlockchairChainStatsApiResponse
	if err := HttpRequest(req, &responseData); err != nil {
		return nil, err
	}
	return &responseData.Data, nil
}
