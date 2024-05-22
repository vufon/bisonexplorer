package externalapi

import (
	"fmt"
	"net/http"
	"time"

	"github.com/decred/dcrdata/v8/db/dbtypes"
	"github.com/decred/dcrdata/v8/mutilchain"
	"github.com/decred/dcrdata/v8/mutilchain/btcrpcutils"
	"github.com/decred/dcrdata/v8/mutilchain/ltcrpcutils"
	"github.com/dustin/go-humanize"
)

var blockcypherUrl = `https://api.blockcypher.com/v1/%s/main/addrs/%s`

type BlockcypherAddressData struct {
	Address            string                           `json:"address"`
	TotalReceived      int64                            `json:"total_received"`
	TotalSent          int64                            `json:"total_sent"`
	Balance            int64                            `json:"balance"`
	UncomfirmedBalance int64                            `json:"unconfirmed_balance"`
	FinalBalance       int64                            `json:"final_balance"`
	Ntx                int64                            `json:"n_tx"`
	UnconfirmedNTx     int64                            `json:"unconfirmed_n_tx"`
	FinalNTx           int64                            `json:"final_n_tx"`
	TxRefs             []BlockcypherAddressTransactions `json:"txrefs"`
	HasMore            bool                             `json:"hasMore"`
	TxUrl              string                           `json:"tx_url"`
}

type BlockcypherAddressTransactions struct {
	TxHash        string `json:"tx_hash"`
	BlockHeight   int64  `json:"block_height"`
	TxInputN      int64  `json:"tx_input_n"`
	TxOutputN     int64  `json:"tx_output_n"`
	Value         int64  `json:"value"`
	RefBalance    int64  `json:"ref_balance"`
	Spent         bool   `json:"spent"`
	SpentBy       string `json:"spent_by"`
	Confirmations int64  `json:"confirmations"`
	Confirmed     string `json:"confirmed"`
	DoubleSpend   bool   `json:"double_spend"`
}

func GetBlockcypherAddressInfoAPI(address string, chainType string, limit, offset, chainHeight int64) (*APIAddressInfo, error) {
	getLimit := offset + limit
	fetchUrl := fmt.Sprintf(blockcypherUrl, chainType, address)
	var fetchData BlockcypherAddressData
	query := map[string]string{
		"limit": fmt.Sprintf("%d", getLimit),
	}
	req := &ReqConfig{
		Method:  http.MethodGet,
		HttpUrl: fetchUrl,
		Payload: query,
	}
	if err := HttpRequest(req, &fetchData); err != nil {
		return nil, err
	}
	var creditTxns, debitTxns []*dbtypes.AddressTx
	transactions := make([]*dbtypes.AddressTx, 0, len(fetchData.TxRefs))
	numUnconfirmed := int64(0)
	//handler tx for address info
	for i := offset; i < (offset + limit); i++ {
		if int(i) > len(fetchData.TxRefs)-1 {
			break
		}
		txRef := fetchData.TxRefs[i]
		txSize, txTime := GetTransactionTimeAndSize(txRef.TxHash, chainType)
		addrTx := dbtypes.AddressTx{
			TxID:          txRef.TxHash,
			Size:          uint32(txSize),
			FormattedSize: humanize.Bytes(uint64(txSize)),
			Time:          dbtypes.NewTimeDef(time.Unix(txTime, 0)),
		}

		addrTx.Confirmations = uint64(txRef.Confirmations)
		if addrTx.Confirmations <= 0 {
			numUnconfirmed++
		}
		isFunding := txRef.TxOutputN >= 0
		coin := dbtypes.GetMutilchainCoinAmount(txRef.Value, chainType)
		if isFunding {
			addrTx.ReceivedTotal = coin
			if txRef.Spent {
				addrTx.MatchedTx = txRef.SpentBy
			}
			addrTx.Total = coin
			creditTxns = append(creditTxns, &addrTx)
		} else {
			addrTx.SentTotal = coin
			addrTx.Total = coin
			debitTxns = append(debitTxns, &addrTx)
		}
		addrTx.IsFunding = isFunding
		transactions = append(transactions, &addrTx)
	}

	addressInfo := &APIAddressInfo{
		Address:         address,
		Transactions:    transactions,
		TxnsFunding:     creditTxns,
		TxnsSpending:    debitTxns,
		NumFundingTxns:  int64(len(creditTxns)),
		NumSpendingTxns: int64(len(debitTxns)),
		Received:        fetchData.TotalReceived,
		Sent:            fetchData.TotalSent,
		Unspent:         fetchData.TotalReceived - fetchData.TotalSent,
		NumUnconfirmed:  numUnconfirmed,
		NumTransactions: fetchData.Ntx,
	}

	return addressInfo, nil
}

func GetTransactionTimeAndSize(txHash, chainType string) (int64, int64) {
	switch chainType {
	case mutilchain.TYPELTC:
		if LTCClient == nil {
			return 0, 0
		}
		return ltcrpcutils.GetTransactionTimeAndSize(LTCClient, txHash)
	case mutilchain.TYPEBTC:
		if BTCClient == nil {
			return 0, 0
		}
		return btcrpcutils.GetTransactionTimeAndSize(BTCClient, txHash)
	}
	return 0, 0
}
