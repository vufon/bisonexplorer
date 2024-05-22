package externalapi

import (
	"fmt"

	btcClient "github.com/btcsuite/btcd/rpcclient"
	"github.com/decred/dcrdata/v8/db/dbtypes"
	ltcClient "github.com/ltcsuite/ltcd/rpcclient"
)

var (
	LTCClient *ltcClient.Client
	BTCClient *btcClient.Client
)

type APIAddressInfo struct {
	Address         string
	Transactions    []*dbtypes.AddressTx
	TxnsFunding     []*dbtypes.AddressTx
	TxnsSpending    []*dbtypes.AddressTx
	NumTransactions int64
	NumFundingTxns  int64
	NumSpendingTxns int64
	Received        int64
	Sent            int64
	Unspent         int64
	NumUnconfirmed  int64
}

const (
	BLockchainAPI  = "blockchain"
	BlockcypherAPI = "blockcypher"
)

var APIList = []string{BLockchainAPI, BlockcypherAPI}

func GetAPIMutilchainAddressDetails(address string, chainType string, limit, offset, chainHeight int64) (*APIAddressInfo, error) {
	for _, api := range APIList {
		//Get from API
		addrInfo, err := GetAddressDetailsByAPIEnv(address, chainType, api, limit, offset, chainHeight)
		if err == nil {
			return addrInfo, nil
		}
	}
	return nil, fmt.Errorf("%s", "Get address info from API failed")
}

func GetAddressDetailsByAPIEnv(address, chainType, apiType string, limit, offset, chainHeight int64) (*APIAddressInfo, error) {
	switch apiType {
	case BLockchainAPI:
		return GetBlockchainInfoAddressInfoAPI(address, chainType, limit, offset, chainHeight)
	case BlockcypherAPI:
		return GetBlockcypherAddressInfoAPI(address, chainType, limit, offset, chainHeight)
	default:
		return nil, fmt.Errorf("%s%s", "Get by API failed, API type:", apiType)
	}
}
