package externalapi

import (
	"fmt"
	"net/http"
	"time"

	"github.com/decred/dcrdata/v8/db/dbtypes"
	"github.com/decred/dcrdata/v8/mutilchain"
	"github.com/decred/dcrdata/v8/mutilchain/btcrpcutils"
	"github.com/decred/dcrdata/v8/mutilchain/ltcrpcutils"
	"github.com/decred/dcrdata/v8/txhelpers"
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
	UnconfirmedTxRefs  []BlockcypherAddressTransactions `json:"unconfirmed_txrefs"`
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
	Received      string `json:"received"`
	DoubleSpend   bool   `json:"double_spend"`
}

func GetBlockCypherData(url string, limit int64) (*BlockcypherAddressData, error) {
	var fetchData BlockcypherAddressData
	query := map[string]string{
		"limit": fmt.Sprintf("%d", limit),
	}
	req := &ReqConfig{
		Method:  http.MethodGet,
		HttpUrl: url,
		Payload: query,
	}
	if err := HttpRequest(req, &fetchData); err != nil {
		return nil, err
	}
	return &fetchData, nil
}

func GetBlockcypherAddressInfoAPI(address string, chainType string, limit, offset, chainHeight int64, txnType dbtypes.AddrTxnViewType) (*APIAddressInfo, error) {
	fetchUrl := fmt.Sprintf(blockcypherUrl, chainType, address)
	var fetchData *BlockcypherAddressData
	transactions := make([]*dbtypes.AddressTx, 0)
	numUnconfirmed := int64(0)
	var err error
	var totalTx int64
	totalFunding := int64(0)
	totalSpending := int64(0)
	// Get first information
	firstData, err := GetBlockCypherData(fetchUrl, 10)
	if err != nil {
		return nil, err
	}
	//Get all transactions
	fetchData, err = GetBlockCypherData(fetchUrl, firstData.Ntx)
	if err != nil {
		return nil, err
	}
	//fetch with limit and offset
	countTx := int64(0)
	isFull := false
	newTxRefs := make([]BlockcypherAddressTransactions, 0)
	fullData := fetchData.TxRefs
	fullData = append(fullData, fetchData.UnconfirmedTxRefs...)
	for i := 0; i < len(fullData); i++ {
		if countTx >= offset+limit {
			isFull = true
		}
		txRef := fullData[i]
		isFunding := txRef.TxOutputN == 0
		if isFunding {
			totalFunding++
			if txRef.Spent {
				totalSpending++
			}
		}
		if (txnType == dbtypes.AddrTxnCredit && !isFunding) ||
			(txnType == dbtypes.AddrTxnDebit && isFunding) || (txnType == dbtypes.AddrUnspentTxn && (!isFunding || txRef.Spent)) {
			continue
		}
		countTx++
		if !isFull && countTx > offset {
			newTxRefs = append(newTxRefs, txRef)
		}
	}
	fetchData.TxRefs = newTxRefs
	totalTx = countTx

	for i := 0; i < len(fetchData.TxRefs); i++ {
		txRef := fetchData.TxRefs[i]
		txSize, txTime := GetTransactionTimeAndSize(txRef.TxHash, chainType)
		addrTx := dbtypes.AddressTx{
			TxID:          txRef.TxHash,
			Size:          uint32(txSize),
			FormattedSize: humanize.Bytes(uint64(txSize)),
			Time:          dbtypes.NewTimeDef(time.Unix(txTime, 0)),
		}

		//if is confirmed tx
		addrTx.IsUnconfirmed = txRef.Confirmed == ""
		if addrTx.IsUnconfirmed && txRef.Received != "" {
			parsTime, err := txhelpers.ParsingTime(txRef.Received)
			if err == nil {
				addrTx.Time = dbtypes.NewTimeDef(parsTime)
			}
		}
		addrTx.Confirmations = uint64(txRef.Confirmations)
		if addrTx.Confirmations <= 0 {
			numUnconfirmed++
		}
		isFunding := txRef.TxOutputN == 0
		coin := dbtypes.GetMutilchainCoinAmount(txRef.Value, chainType)
		if isFunding {
			addrTx.ReceivedTotal = coin
			if txRef.Spent {
				addrTx.MatchedTx = txRef.SpentBy
			}
		} else {
			addrTx.SentTotal = coin
		}
		addrTx.Total = coin
		addrTx.IsFunding = isFunding
		transactions = append(transactions, &addrTx)
	}

	addressInfo := &APIAddressInfo{
		Address:         address,
		Transactions:    transactions,
		Received:        fetchData.TotalReceived,
		Sent:            fetchData.TotalSent,
		Unspent:         fetchData.TotalReceived - fetchData.TotalSent,
		NumUnconfirmed:  numUnconfirmed,
		NumTransactions: totalTx,
		NumFundingTxns:  totalFunding,
		NumSpendingTxns: totalSpending,
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
