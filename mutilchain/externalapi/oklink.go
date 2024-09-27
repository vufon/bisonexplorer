package externalapi

import (
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/decred/dcrdata/v8/db/dbtypes"
	"github.com/dustin/go-humanize"
)

const okAPIURL = "https://www.oklink.com/api/v5/explorer"

var okLinkAddressDetailUrl = `/address/address-summary`
var okLinkAddressTxsUrl = `/address/transaction-list`
var blockchainSummaryURL = `/blockchain/summary`

type OkLinkBlockchainSummaryResponseData struct {
	Code string                        `json:"code"`
	Msg  string                        `json:"msg"`
	Data []OkLinkBlockchainSummaryData `json:"data"`
}

type OkLinkSummaryResponseData struct {
	Code string              `json:"code"`
	Msg  string              `json:"msg"`
	Data []OkLinkSummaryData `json:"data"`
}

type OkLinkBlockchainSummaryData struct {
	ChainFullName               string `json:"chainFullName"`
	ChainShortName              string `json:"chainShortName"`
	Symbol                      string `json:"symbol"`
	LastHeight                  string `json:"lastHeight"`
	LastBlockTime               string `json:"lastBlockTime"`
	CirculatingSupply           string `json:"circulatingSupply"`
	CirculatingSupplyProportion string `json:"circulatingSupplyProportion"`
	Transactions                string `json:"transactions"`
}

type OkLinkSummaryData struct {
	Balance       string `json:"balance"`
	TxCount       string `json:"transactionCount"`
	SendAmount    string `json:"sendAmount"`
	ReceiveAmount string `json:"receiveAmount"`
}

type OkLinkAddressTxsResponseData struct {
	Code string              `json:"code"`
	Msg  string              `json:"msg"`
	Data []OkLinkAddrtxsData `json:"data"`
}

type OkLinkAddrtxsData struct {
	Page             string                  `json:"page"`
	Limit            string                  `json:"limit"`
	TotalPage        string                  `json:"totalPage"`
	TransactionLists []OkLinkTransactionData `json:"transactionLists"`
}

type OkLinkTransactionData struct {
	Txid            string `json:"txId"`
	Blockhash       string `json:"blockHash"`
	Height          string `json:"height"`
	TransactionTime string `json:"transactionTime"`
	From            string `json:"from"`
	To              string `json:"to"`
	Amount          string `json:"amount"`
	TxFee           string `json:"txFee"`
	State           string `json:"state"`
}

func GetOkLinkSummaryData(apiKey, chainType, address string) (*OkLinkSummaryResponseData, error) {
	var fetchData OkLinkSummaryResponseData
	query := map[string]string{
		"chainShortName": fmt.Sprintf("%s", chainType),
		"address":        address,
	}
	//insert api key
	headerMap := make(map[string]string)
	headerMap["Ok-Access-Key"] = apiKey
	req := &ReqConfig{
		Method:  http.MethodGet,
		HttpUrl: fmt.Sprintf("%s%s", okAPIURL, okLinkAddressDetailUrl),
		Payload: query,
		Header:  headerMap,
	}
	if err := HttpRequest(req, &fetchData); err != nil {
		return nil, err
	}
	return &fetchData, nil
}

func GetOkLinkAddressTxsData(apiKey, chainType, address string, limit, offset int64) (*OkLinkAddressTxsResponseData, error) {
	var fetchData OkLinkAddressTxsResponseData
	pageNumber := offset/limit + 1
	query := map[string]string{
		"chainShortName": fmt.Sprintf("%s", chainType),
		"address":        address,
		"page":           fmt.Sprintf("%d", pageNumber),
		"limit":          fmt.Sprintf("%d", limit),
	}
	//insert api key
	headerMap := make(map[string]string)
	headerMap["Ok-Access-Key"] = apiKey
	req := &ReqConfig{
		Method:  http.MethodGet,
		HttpUrl: fmt.Sprintf("%s%s", okAPIURL, okLinkAddressTxsUrl),
		Payload: query,
		Header:  headerMap,
	}
	if err := HttpRequest(req, &fetchData); err != nil {
		return nil, err
	}
	return &fetchData, nil
}

func GetOkLinkBlockchainSummaryData(apiKey, chainType string) (float64, int64, error) {
	var fetchData OkLinkBlockchainSummaryResponseData
	query := map[string]string{
		"chainShortName": chainType,
	}
	//insert api key
	headerMap := make(map[string]string)
	headerMap["Ok-Access-Key"] = apiKey
	req := &ReqConfig{
		Method:  http.MethodGet,
		HttpUrl: fmt.Sprintf("%s%s", okAPIURL, blockchainSummaryURL),
		Payload: query,
		Header:  headerMap,
	}
	if err := HttpRequest(req, &fetchData); err != nil {
		return 0, 0, err
	}
	if len(fetchData.Data) == 0 {
		return 0, 0, nil
	}
	coinSupply := float64(0)
	totalTxs := int64(0)
	for _, data := range fetchData.Data {
		if strings.ToLower(data.ChainShortName) == chainType {
			coinSupply, _ = strconv.ParseFloat(data.CirculatingSupply, 64)
			totalTxs, _ = strconv.ParseInt(data.Transactions, 0, 32)
			break
		}
	}
	return coinSupply, totalTxs, nil
}

func GetOkLinkAddressInfoAPI(apiKey, address, chainType string, limit, offset, chainHeight int64, txnType dbtypes.AddrTxnViewType) (*APIAddressInfo, error) {
	if apiKey == "" {
		return nil, fmt.Errorf("Get Block daemon API key failed")
	}
	log.Printf("Start get address data from Oklink API for %s", chainType)
	//Get address summary data
	summaryData, err := GetOkLinkSummaryData(apiKey, chainType, address)
	if err != nil {
		return nil, err
	}
	//Get response code
	resCode, parseErr := strconv.ParseInt(summaryData.Code, 0, 32)
	if parseErr != nil || resCode != 0 || len(summaryData.Data) == 0 {
		return nil, fmt.Errorf("Get address summary data failed")
	}
	txCount, _ := strconv.ParseInt(summaryData.Data[0].TxCount, 0, 32)
	sendAmount, _ := strconv.ParseFloat(summaryData.Data[0].SendAmount, 64)
	balance, _ := strconv.ParseFloat(summaryData.Data[0].Balance, 64)
	receiveAmount, _ := strconv.ParseFloat(summaryData.Data[0].ReceiveAmount, 64)
	addressInfo := &APIAddressInfo{
		Address:         address,
		NumTransactions: txCount,
		Sent:            int64(sendAmount * 1e8),
		Received:        int64(receiveAmount * 1e8),
		NumFundingTxns:  0,
		NumSpendingTxns: 0,
		NumUnconfirmed:  0,
		Unspent:         int64(balance * 1e8),
	}

	//Get address transaction list
	addrTxsResponse, err := GetOkLinkAddressTxsData(apiKey, chainType, address, limit, offset)
	if err != nil {
		return nil, err
	}
	txsResCode, parseErr := strconv.ParseInt(addrTxsResponse.Code, 0, 32)
	if parseErr != nil || txsResCode != 0 || len(addrTxsResponse.Data) == 0 {
		return nil, fmt.Errorf("Get address tx list data failed")
	}
	transactions := make([]*dbtypes.AddressTx, 0)
	for _, txData := range addrTxsResponse.Data[0].TransactionLists {
		coin, _ := strconv.ParseFloat(txData.Amount, 64)
		isFunding := coin >= 0
		txTime, txSize, confirmations := GetMutilchainTxTimeSizeConfirmations(txData.Txid, chainType)
		addrTx := dbtypes.AddressTx{
			TxID:          txData.Txid,
			Size:          uint32(txSize),
			FormattedSize: humanize.Bytes(uint64(txSize)),
			Time:          dbtypes.NewTimeDef(time.Unix(txTime, 0)),
			Confirmations: uint64(confirmations),
		}
		if isFunding {
			addrTx.ReceivedTotal = coin
		} else {
			addrTx.SentTotal = coin
		}
		addrTx.Total = coin
		addrTx.IsFunding = isFunding
		addrTx.IsUnconfirmed = txData.State == "success"
		transactions = append(transactions, &addrTx)
	}
	addressInfo.Transactions = transactions
	log.Printf("Finish get address data from Oklink API for %s", chainType)
	return addressInfo, nil
}

func IsCredit(address, toAddresses string) bool {
	toArr := strings.Split(toAddresses, ",")
	for _, to := range toArr {
		if to == address {
			return true
		}
	}
	return false
}
