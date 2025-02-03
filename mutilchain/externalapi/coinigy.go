package externalapi

import (
	"fmt"
	"net/http"

	"github.com/decred/dcrdata/v8/db/dbtypes"
)

var coinigyMarketURL = `https://api.coinigy.com/api/v2/public/markets/market-summaries`

type CoinigyMarketResponse struct {
	Success      bool            `json:"success"`
	Error        any             `json:"error"`
	PageSize     int             `json:"pageSize"`
	CurrentPage  int             `json:"currentPage"`
	TotalPages   int             `json:"totalPages"`
	TotalRecords int             `json:"totalRecords"`
	Links        any             `json:"links"`
	Result       []CoinigyResult `json:"result"`
}

type CoinigyResult struct {
	LastTradePrice    float64 `json:"lastTradePrice"`
	LastTradeQuantity float64 `json:"lastTradeQuantity"`
	LastTradeTime     string  `json:"lastTradeTime"`
	Volume24Btc       float64 `json:"volume24Btc"`
	BtcPrice          float64 `json:"btcPrice"`
	Percent24         float64 `json:"percent24"`
	Indicators        any     `json:"indicators"`
	FavoritesScore    int     `json:"favoritesScore"`
	MiniChartData     any     `json:"miniChartData"`
	PercentChange     float64 `json:"percentChange"`
	Volume            float64 `json:"volume"`
}

func GetCoinigyCapData(blockchainList []string) []*dbtypes.MarketCapData {
	result := make([]*dbtypes.MarketCapData, 0)
	for _, chain := range blockchainList {
		query := map[string]string{
			"PageSize":     "100",
			"baseCurrCode": chain,
			"range":        "OneDay",
		}
		pageNum := 1
		volSum := float64(0)
		strongSum := float64(0)
		for {
			query["PageNumber"] = fmt.Sprintf("%d", pageNum)
			req := &ReqConfig{
				Method:  http.MethodGet,
				HttpUrl: coinigyMarketURL,
				Payload: query,
			}
			var responseData CoinigyMarketResponse
			if err := HttpRequest(req, &responseData); err != nil {
				break
			}
			if !responseData.Success || len(responseData.Result) == 0 {
				break
			}
			for _, res := range responseData.Result {
				volSum += res.Volume
				strongSum += res.Volume * res.PercentChange
			}
			pageNum++
		}
		perChange := float64(0)
		if volSum > 0 {
			perChange = strongSum / volSum
		}
		result = append(result, &dbtypes.MarketCapData{
			Symbol:        chain,
			SymbolDisplay: chain,
			Percentage1D:  perChange,
			Volumn:        volSum,
			Name:          chain,
		})
	}
	return result
}
