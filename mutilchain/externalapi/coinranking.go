package externalapi

import (
	"fmt"
	"net/http"
	"strconv"
)

const coinRankingAPIURL = "https://api.coinranking.com/v2/coin/%s"

var coinUUID = map[string]string{
	"btc": "Qwsogvtv82FCd",
	"ltc": "D7B1x_ks7WhV5",
}

type CoinRankingResponse struct {
	Status string              `json:"status"`
	Data   CoinRankingItemData `json:"data"`
}

type CoinRankingItemData struct {
	Coin CoinRankingCoinData `json:"coin"`
}

type CoinRankingCoinData struct {
	Supply CoinRankingItemSupplyData `json:"supply"`
}

type CoinRankingItemSupplyData struct {
	Total       string `json:"total"`
	Circulating string `json:"circulating"`
}

// get coin supply from coinranking api
func GetCoinRankingCoinSupply(chainType string) (float64, error) {
	var fetchData CoinRankingResponse
	req := &ReqConfig{
		Method:  http.MethodGet,
		HttpUrl: fmt.Sprintf(coinRankingAPIURL, coinUUID[chainType]),
		Payload: map[string]string{},
	}
	if err := HttpRequest(req, &fetchData); err != nil {
		return 0, err
	}
	if fetchData.Status != "success" {
		return 0, nil
	}
	coinSupply, err := strconv.ParseFloat(fetchData.Data.Coin.Supply.Circulating, 64)
	if err != nil {
		return 0, err
	}
	return coinSupply, nil
}
