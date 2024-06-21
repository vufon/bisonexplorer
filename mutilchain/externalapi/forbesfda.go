package externalapi

import (
	"net/http"
	"slices"

	"github.com/decred/dcrdata/v8/db/dbtypes"
)

var forbesMarketURL = `https://fda.forbes.com/v2/tradedAssets`

type MarketCapResponse struct {
	Assets []MarketAssetData `json:"assets"`
	Total  int64             `json:"total"`
	Source string            `json:"source"`
}

type MarketAssetData struct {
	Symbol        string  `json:"symbol"`
	DisplaySymbol string  `json:"displaySymbol"`
	Name          string  `json:"name"`
	Logo          string  `json:"logo"`
	Price         float64 `json:"price"`
	Percentage    float64 `json:"percentage"`
	Percentage1H  float64 `json:"percentage_1h"`
	Percentage7D  float64 `json:"percentage_7d"`
	ChangeValue   float64 `json:"changeValue"`
	MarketCap     float64 `json:"marketCap"`
	Volumn        float64 `json:"volume"`
}

func GetMarketCapData(blockchainList []string) []*dbtypes.MarketCapData {
	query := map[string]string{
		"limit":    "12000",
		"pageNum":  "1",
		"category": "ft",
	}
	req := &ReqConfig{
		Method:  http.MethodGet,
		HttpUrl: forbesMarketURL,
		Payload: query,
	}
	var responseData MarketCapResponse
	result := make([]*dbtypes.MarketCapData, 0)
	if err := HttpRequest(req, &responseData); err != nil {
		return result
	}
	if len(responseData.Assets) > 0 {
		for _, asset := range responseData.Assets {
			//check exist on chainList
			if !slices.Contains(blockchainList, asset.Symbol) {
				continue
			}
			result = append(result, &dbtypes.MarketCapData{
				Symbol:        asset.Symbol,
				SymbolDisplay: asset.DisplaySymbol,
				Price:         asset.Price,
				Percentage1D:  asset.Percentage,
				Percentage7D:  asset.Percentage7D,
				MarketCap:     asset.MarketCap,
				Volumn:        asset.Volumn,
				IconUrl:       asset.Logo,
				Name:          asset.Name,
			})
		}
	}

	sortedResult := make([]*dbtypes.MarketCapData, 0)
	for _, chain := range blockchainList {
		for _, res := range result {
			if res.Symbol == chain {
				sortedResult = append(sortedResult, res)
			}
		}
	}

	return sortedResult
}
