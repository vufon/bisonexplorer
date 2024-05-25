// Copyright (c) 2013-2015 The btcsuite developers
// Use of this source code is governed by an ISC
// license that can be found in the LICENSE file.

package chainsocket

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"sync"
	"time"

	"github.com/btcsuite/btcd/btcutil"
	"github.com/decred/dcrdata/cmd/dcrdata/internal/explorer"
	"github.com/decred/dcrdata/v8/explorer/types"
	"github.com/decred/dcrdata/v8/mutilchain"
	"github.com/ltcsuite/ltcd/ltcutil"
)

type WebsocketProcessor func([]byte)

type MutilchainInfoSocket struct {
	mtx             sync.RWMutex
	wsMtx           sync.RWMutex
	ws              websocketFeed
	sr              signalrClient
	ChainType       string
	Exp             *explorer.ExplorerUI
	MempoolInfoChan chan *types.MutilchainMempoolInfo
	wsSync          struct {
		err      error
		errCount int
		init     time.Time
		update   time.Time
		fail     time.Time
	}
	wsProcessor WebsocketProcessor
	apiUrl      string
}

type MempoolInfoData struct {
	MempoolInfo     interface{}   `json:"mempoolInfo"`
	VBytesPerSecond int64         `json:"vBytesPerSecond"`
	Transactions    []interface{} `json:"transactions"`
	Da              interface{}   `json:"da"`
	Fees            interface{}   `json:"fees"`
	MempoolBlocks   []interface{} `json:"mempool-blocks"`
}

type MempoolMutilBlocksData struct {
	Blocks          []interface{} `json:"blocks"`
	MempoolBlocks   []interface{} `json:"mempool-blocks"`
	MempoolInfo     interface{}   `json:"mempoolInfo"`
	VBytesPerSecond int64         `json:"vBytesPerSecond"`
	Fees            interface{}   `json:"fees"`
	Da              interface{}   `json:"da"`
}

type MempoolSimpleBlocksData struct {
	Block         interface{}   `json:"block"`
	MempoolInfo   interface{}   `json:"mempoolInfo"`
	Da            interface{}   `json:"da"`
	Fees          interface{}   `json:"fees"`
	MempoolBlocks []interface{} `json:"mempool-blocks"`
}

const (
	MempoolInfoKey    = "mempoolInfo"
	TransactionsKey   = "transactions"
	SimpleBlockKey    = "block"
	MutilBlockKey     = "blocks"
	LitecoinSocketURL = "wss://litecoinspace.org/api/v1/ws"
	BitcoinSocketURL  = "wss://mempool.space/api/v1/ws"
)

func NewMutilchainInfoSocket(explorer *explorer.ExplorerUI, chainType string) (*MutilchainInfoSocket, error) {
	infoSocket := &MutilchainInfoSocket{
		Exp:             explorer,
		ChainType:       chainType,
		MempoolInfoChan: make(chan *types.MutilchainMempoolInfo, 16),
	}
	switch chainType {
	case mutilchain.TYPEBTC:
		infoSocket.apiUrl = BitcoinSocketURL
	case mutilchain.TYPELTC:
		infoSocket.apiUrl = LitecoinSocketURL
	default:
		return nil, fmt.Errorf("%s", "Chain type error for create external API socket")
	}
	return infoSocket, nil
}

func (sk *MutilchainInfoSocket) StartMempoolConnectAndUpdate() error {
	skFailed, wsStarting := sk.WsMempoolStatus(sk.ConnectWs)
	if skFailed || !wsStarting {
		return fmt.Errorf("%s", "Start socket failed")
	}
	if !wsStarting {
		sinceLast := time.Since(sk.wsLastUpdate())
		log.Printf("last %s websocket update %.3f seconds ago", sk.ChainType, sinceLast.Seconds())
	}
	return nil
}

type APISubscription struct {
	Action string   `json:"action"`
	Data   []string `json:"data"`
}

var InfoSubscription = APISubscription{
	Action: "want",
	Data:   []string{"blocks", "stats", "mempool-blocks", "live-2h-chart", "watch-mempool", "block-transactions"},
}

func (sk *MutilchainInfoSocket) ConnectWs() {
	err := sk.connectWebsocket(sk.processWsMessage, &socketConfig{
		address: sk.apiUrl,
	})
	if err != nil {
		log.Printf("connectWs: %v", err)
		return
	}
	err = sk.wsSend(InfoSubscription)
	if err != nil {
		log.Printf("Failed to send order book sub to polo: %v", err)
	}
}

func IsExistKey(raw []byte, key string) bool {
	res := make(map[string]any)
	err := json.Unmarshal(raw, &res)
	if err != nil {
		return false
	}
	_, exist := res[key]
	return exist
}

func (sk *MutilchainInfoSocket) wsListening() bool {
	sk.wsMtx.RLock()
	defer sk.wsMtx.RUnlock()
	return sk.wsSync.init.After(sk.wsSync.fail)
}

func (sk *MutilchainInfoSocket) wsFailed() bool {
	sk.wsMtx.RLock()
	defer sk.wsMtx.RUnlock()
	return sk.wsSync.fail.After(sk.wsSync.init)
}

func (sk *MutilchainInfoSocket) wsErrorCount() int {
	sk.wsMtx.RLock()
	defer sk.wsMtx.RUnlock()
	return sk.wsSync.errCount
}

func (sk *MutilchainInfoSocket) wsFailTime() time.Time {
	sk.wsMtx.RLock()
	defer sk.wsMtx.RUnlock()
	return sk.wsSync.fail
}

func (sk *MutilchainInfoSocket) WsMempoolStatus(connector func()) (skFailed, initializing bool) {
	if sk.wsListening() {
		return
	}
	if !sk.wsFailed() {
		// Connection has not been initialized. Trigger a silent update, since an
		// update will be triggered on initial websocket message, which contains
		// the full orderbook.
		initializing = true
		log.Printf("Initializing websocket for %s mempool connection successfully", sk.ChainType)
		connector()
		return
	}
	skFailed = true
	errCount := sk.wsErrorCount()
	var delay time.Duration
	// wsDepthStatus is only called every DataExpiry, so a delay of zero is ok
	// until there are a few consecutive errors.
	switch {
	case errCount < 5:
	case errCount < 20:
		delay = 10 * time.Minute
	default:
		delay = time.Minute * 60
	}
	okToTry := sk.wsFailTime().Add(delay)
	if time.Now().After(okToTry) {
		// Try to connect, but don't wait for the response. Grab the order
		// book over HTTP anyway.
		connector()
	} else {
		log.Printf("Websocket disabled. Too many errors. Will attempt to reconnect after %.1f minutes", time.Until(okToTry).Minutes())
	}
	return
}

func (sk *MutilchainInfoSocket) wsSend(msg interface{}) error {
	ws, _ := sk.websocket()
	if ws == nil {
		// TODO: figure out why we are sending in this state
		return errors.New("no connection")
	}
	return ws.Write(msg)
}

func (sk *MutilchainInfoSocket) connectWebsocket(processor WebsocketProcessor, cfg *socketConfig) error {
	ws, err := NewSocketConnection(cfg)
	if err != nil {
		return err
	}

	sk.wsMtx.Lock()
	// Ensure that any previous websocket is closed.
	if sk.ws != nil {
		sk.ws.Close()
	}
	sk.wsProcessor = processor
	sk.ws = ws
	sk.wsMtx.Unlock()

	sk.startWebsocket()
	return nil
}

func (sk *MutilchainInfoSocket) startWebsocket() {
	ws, processor := sk.websocket()
	go func() {
		for {
			message, err := ws.Read()
			if err != nil {
				sk.setWsFail(err)
				return
			}
			processor(message)
		}
	}()
}

func (sk *MutilchainInfoSocket) setWsFail(err error) {
	log.Printf("API websocket error: %v", err)
	sk.wsMtx.Lock()
	defer sk.wsMtx.Unlock()
	if sk.ws != nil {
		sk.ws.Close()
		// Clear the field to prevent double Close'ing.
		sk.ws = nil
	}
	if sk.sr != nil {
		// The carterjones/signalr can hang on Close. The goroutine is a stopgap while
		// we migrate to a new signalr client.
		// https://github.com/decred/dcrdata/issues/1818
		go sk.sr.Close()
		// Clear the field to prevent double Close'ing. signalr will hang on
		// second call.
		sk.sr = nil
	}
	sk.wsSync.err = err
	sk.wsSync.errCount++
	sk.wsSync.fail = time.Now()
}

func (sk *MutilchainInfoSocket) websocket() (websocketFeed, WebsocketProcessor) {
	sk.mtx.RLock()
	defer sk.mtx.RUnlock()
	return sk.ws, sk.wsProcessor
}

func (sk *MutilchainInfoSocket) processWsMessage(raw []byte) {
	if IsExistKey(raw, MempoolInfoKey) {
		sk.HandlerMempoolInfoData(raw)
	}
	if IsExistKey(raw, SimpleBlockKey) {
		sk.HandlerSimpleBlockData(raw)
	}
	if IsExistKey(raw, MutilBlockKey) {
		sk.HandlerMutilBlocksData(raw)
	}

	sk.wsUpdated()
}

func (sk *MutilchainInfoSocket) HandlerSimpleBlockData(raw []byte) {
	log.Printf("Start handler simple Block Data for %s", sk.ChainType)
	var blockData MempoolSimpleBlocksData
	parseErr := json.Unmarshal(raw, &blockData)
	if parseErr != nil {
		log.Printf("Parse %s for block websocket failed. %v", sk.ChainType, parseErr)
		return
	}

	homeInfo := sk.getHomeInfo()
	if homeInfo == nil {
		return
	}
	blockMap, err := ConvertInterfaceToMap(blockData.Block)
	if err != nil {
		log.Printf("Check block map failed, %v", err)
		return
	}
	homeInfo.LastBlockHash = ConvertAnyToString(blockMap["id"])
	homeInfo.LastBlockHeight = ConvertAnyToInt(blockMap["height"])
	homeInfo.LastBlockTime = ConvertAnyToInt(blockMap["timestamp"])
	homeInfo.FormattedBlockTime = (types.TimeDef{T: time.Unix(homeInfo.LastBlockTime, 0)}).String()
	extrasInfo, err := ConvertInterfaceToMap(blockMap["extras"])
	if err != nil {
		log.Printf("Convert to map failed: %v", err)
		return
	}
	homeInfo.InputsCount = ConvertAnyToInt(extrasInfo["totalInputs"])
	homeInfo.OutputsCount = ConvertAnyToInt(extrasInfo["totalOutputs"])
	homeInfo.TotalOut = GetMutilchainUnitAmount(ConvertAnyToInt(extrasInfo["totalOutputAmt"]), sk.ChainType)
	sk.UpdateMutilchainHomeInfo(homeInfo)
}

func (sk *MutilchainInfoSocket) HandlerMutilBlocksData(raw []byte) {
	log.Printf("Start handler mutil Blocks Data for %s", sk.ChainType)
	var blocksData MempoolMutilBlocksData
	parseErr := json.Unmarshal(raw, &blocksData)
	if parseErr != nil {
		log.Printf("Parse %s for blocks websocket failed. %v", sk.ChainType, parseErr)
		return
	}
	homeInfo := sk.getHomeInfo()
	if homeInfo == nil {
		return
	}
	blocks := blocksData.Blocks
	totalInputs := int64(0)
	totalOutpus := int64(0)
	totalOut := float64(0)
	for i := 0; i < len(blocks); i++ {
		blockMap, err := ConvertInterfaceToMap(blocks[i])
		if err != nil {
			continue
		}
		//if is last block, save to homeinfo
		if i == len(blocks)-1 {
			homeInfo.LastBlockHash = ConvertAnyToString(blockMap["id"])
			homeInfo.LastBlockHeight = ConvertAnyToInt(blockMap["height"])
			homeInfo.LastBlockTime = ConvertAnyToInt(blockMap["timestamp"])
			homeInfo.FormattedBlockTime = (types.TimeDef{T: time.Unix(homeInfo.LastBlockTime, 0)}).String()
		}
		//sum all info
		extrasInfo, err := ConvertInterfaceToMap(blockMap["extras"])
		if err != nil {
			continue
		}
		totalInputs += ConvertAnyToInt(extrasInfo["totalInputs"])
		totalOutpus += ConvertAnyToInt(extrasInfo["totalOutputs"])
		totalOut += GetMutilchainUnitAmount(ConvertAnyToInt(extrasInfo["totalOutputAmt"]), sk.ChainType)
	}
	homeInfo.InputsCount = totalInputs
	homeInfo.OutputsCount = totalOutpus
	homeInfo.TotalOut = totalOut
	sk.UpdateMutilchainHomeInfo(homeInfo)
}

func (sk *MutilchainInfoSocket) HandlerMempoolInfoData(raw []byte) {
	var response MempoolInfoData
	parseErr := json.Unmarshal(raw, &response)
	if parseErr != nil {
		log.Printf("Parse %s websocket failed. %v", sk.ChainType, parseErr)
		return
	}
	if sk.Exp == nil {
		return
	}
	homeInfo := sk.getHomeInfo()
	if homeInfo == nil {
		return
	}
	//get mempool info
	memInfoMap, err := ConvertInterfaceToMap(response.MempoolInfo)
	if err != nil {
		return
	}
	//Get Tx Count
	txCount := ConvertAnyToInt(memInfoMap["size"])
	//Get total fee
	totalFee := sk.GetMutilchainTotalFee(memInfoMap, response.MempoolBlocks)
	minFeeRatevB := math.MaxFloat64
	maxFeeRatevB := float64(0)
	size := int64(0)
	for _, blockMempool := range response.MempoolBlocks {
		blockMempoolMap, err := ConvertInterfaceToMap(blockMempool)
		if err != nil {
			continue
		}
		//Get blockSize
		blockSize := ConvertAnyToInt(blockMempoolMap["blockSize"])
		size += blockSize

		//Fee range
		feeRange := ConvertAnyToFloatArray(blockMempoolMap["feeRange"])
		for _, fee := range feeRange {
			if minFeeRatevB > fee {
				minFeeRatevB = fee
			}
			if maxFeeRatevB < fee {
				maxFeeRatevB = fee
			}
		}
	}

	//handler transactions
	txList := make([]types.MempoolTx, 0)
	for _, txInfo := range response.Transactions {
		txObjMap, err := ConvertInterfaceToMap(txInfo)
		if err != nil {
			continue
		}
		txId := ConvertAnyToString(txObjMap["txid"])
		if txId == "" {
			continue
		}
		insertTx := types.MempoolTx{
			Hash:     txId,
			TxID:     txId,
			Fees:     GetMutilchainUnitAmount(ConvertAnyToInt(txObjMap["fee"]), sk.ChainType),
			TotalOut: GetMutilchainUnitAmount(ConvertAnyToInt(txObjMap["value"]), sk.ChainType),
			FeeRate:  ConvertAnyToFloat(txObjMap["rate"]),
		}
		txList = append(txList, insertTx)
	}

	sortedTxList := make([]types.MempoolTx, 0)
	for i := len(txList) - 1; i >= 0; i-- {
		sortedTxList = append(sortedTxList, txList[i])
	}

	homeInfo.TotalTransactions = txCount
	homeInfo.TotalFee = totalFee
	homeInfo.TotalSize = int32(size)
	homeInfo.MinFeeRatevB = minFeeRatevB
	homeInfo.MaxFeeRatevB = maxFeeRatevB
	homeInfo.Transactions = sortedTxList
	homeInfo.FormattedTotalSize = types.BytesString(uint64(size))
	sk.UpdateMutilchainHomeInfo(homeInfo)
}

func (sk *MutilchainInfoSocket) GetFeeRatevB() (float64, float64) {
	return 0, 0
}

func (sk *MutilchainInfoSocket) GetMutilchainTotalFee(mempoolInfoMap map[string]any, mempoolBlocks []interface{}) float64 {
	switch sk.ChainType {
	case mutilchain.TYPEBTC:
		return sk.GetBTCTotalFee(mempoolInfoMap)
	case mutilchain.TYPELTC:
		return sk.GetLTCTotalFee(mempoolBlocks)
	}
	return 0
}

func (sk *MutilchainInfoSocket) GetBTCTotalFee(mempoolInfoMap map[string]any) float64 {
	return ConvertAnyToFloat(mempoolInfoMap["total_fee"])
}

func (sk *MutilchainInfoSocket) GetLTCTotalFee(mempoolBlocks []interface{}) float64 {
	totalFee := int64(0)
	for _, blockMempool := range mempoolBlocks {
		blockMempoolMap, err := ConvertInterfaceToMap(blockMempool)
		if err != nil {
			continue
		}
		totalFee += ConvertAnyToInt(blockMempoolMap["totalFees"])
	}
	return ltcutil.Amount(totalFee).ToBTC()
}

func GetMutilchainUnitAmount(intValue int64, chainType string) float64 {
	switch chainType {
	case mutilchain.TYPELTC:
		return ltcutil.Amount(intValue).ToBTC()
	case mutilchain.TYPEBTC:
		return btcutil.Amount(intValue).ToBTC()
	default:
		return 0
	}
}

func (sk *MutilchainInfoSocket) UpdateMutilchainHomeInfo(homeInfo *types.MutilchainMempoolInfo) {
	switch sk.ChainType {
	case mutilchain.TYPELTC:
		sk.Exp.LtcMempoolInfo = homeInfo
	case mutilchain.TYPEBTC:
		sk.Exp.BtcMempoolInfo = homeInfo
	default:
		return
	}
}

func ConvertAnyToFloatArray(data any) []float64 {
	if data == nil {
		return []float64{}
	}
	byteArr, err := json.Marshal(data)
	if err != nil {
		return []float64{}
	}
	result := make([]float64, 0)
	if parseErr := json.Unmarshal(byteArr, &result); parseErr != nil {
		return []float64{}
	}
	return result
}

func ConvertAnyToFloat(data any) float64 {
	if data == nil {
		return 0
	}
	dataFlt, ok := data.(float64)
	if !ok {
		return 0
	}
	return dataFlt
}

func ConvertAnyToString(data any) string {
	if data == nil {
		return ""
	}
	dataFlt, ok := data.(string)
	if !ok {
		return ""
	}
	return dataFlt
}

func ConvertAnyToInt(data any) int64 {
	if data == nil {
		return 0
	}
	dataFlt, ok := data.(float64)
	if !ok {
		return 0
	}
	return int64(dataFlt)
}

func ConvertInterfaceToMap(data interface{}) (map[string]any, error) {
	byteArr, err := json.Marshal(data)
	if err != nil {
		return nil, err
	}
	result := make(map[string]any)
	if parseErr := json.Unmarshal(byteArr, &result); parseErr != nil {
		return nil, parseErr
	}
	return result, nil
}

func (sk *MutilchainInfoSocket) getHomeInfo() *types.MutilchainMempoolInfo {
	switch sk.ChainType {
	case mutilchain.TYPELTC:
		return sk.Exp.LtcMempoolInfo
	case mutilchain.TYPEBTC:
		return sk.Exp.BtcMempoolInfo
	default:
		return nil
	}
}

func (sk *MutilchainInfoSocket) wsLastUpdate() time.Time {
	sk.wsMtx.RLock()
	defer sk.wsMtx.RUnlock()
	return sk.wsSync.update
}

func (sk *MutilchainInfoSocket) wsUpdated() {
	sk.wsMtx.Lock()
	defer sk.wsMtx.Unlock()
	sk.wsSync.update = time.Now()
	sk.wsSync.errCount = 0
}
