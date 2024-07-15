package externalapi

import (
	"fmt"
	"net/http"

	"github.com/decred/dcrdata/v8/db/dbtypes"
)

var litecoinSpaceUrl = "https://litecoinspace.org/api/"

func GetLTCAPITransactionData(txid string) (*dbtypes.APITransactionData, error) {
	req := &ReqConfig{
		Method:  http.MethodGet,
		HttpUrl: fmt.Sprintf("%stx/%s", litecoinSpaceUrl, txid),
		Payload: map[string]string{},
	}
	var responseData dbtypes.APITransactionData
	if err := HttpRequest(req, &responseData); err != nil {
		return nil, err
	}
	return &responseData, nil
}
