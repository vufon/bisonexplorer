package externalapi

import (
	"compress/flate"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"github.com/decred/dcrdata/v8/db/dbtypes"
	"github.com/decred/dcrdata/v8/utils"
)

const (
	SUPPORTXMR  = "supportxmr"
	NANOPOOL    = "nanopool"
	HASHVAULT   = "hashvault"
	P2POOL      = "p2pool"
	C3POOL      = "c3pool"
	MONEROOCEAN = "moneroocean"
	XMRPOOL     = "xmrpool"
	HEROMINERS  = "herominers"
	MONEROHASH  = "monerohash"
	DXPOOL      = "dxpool"
)

var poolName = map[string]string{
	"supportxmr":  "Support XMR",
	"nanopool":    "Nano Pool",
	"hashvault":   "HashVault",
	"p2pool":      "P2Pool",
	"c3pool":      "C3Pool",
	"moneroocean": "MoneroOcean",
	"xmrpool":     "XMRPool",
	"herominers":  "Herominers",
	"monerohash":  "MoneroHash",
	"dxpool":      "DxPool",
}

var supportXmrURL = `https://www.supportxmr.com/api/pool/blocks`
var nanoPoolURL = `https://xmr.nanopool.org/api/v1/pool/blocks/0/10`
var hashvaultURL = `https://api.hashvault.pro/v3/monero/pool/blocks`
var p2poolURL = `https://p2pool.io/api/pool/blocks`
var c3poolURL = `https://api.c3pool.com/pool/blocks`
var moneroOceanURL = `https://api.moneroocean.stream/pool/blocks`
var xmrPoolURL = `https://web.xmrpool.eu:8119/stats`
var heroMinersURL = `https://monero.herominers.com/api/stats`
var moneroHashURL = `https://monerohash.com/api/stats`
var dxPoolURL = `https://www.dxpool.com/api/pools/xmr/blocks?page_size=10&offset=0`

type SupportXmrResponseData struct {
	Ts       string `json:"ts"`
	Hash     string `json:"hash"`
	Diff     string `json:"diff"`
	Shares   string `json:"shares"`
	Height   int64  `json:"height"`
	Valid    bool   `json:"valid"`
	Unlocked bool   `json:"unlocked"`
	PoolType string `json:"pool_type"`
	Value    string `json:"value"`
	Finder   string `json:"finder"`
}

type NanoPoolResponse struct {
	Status bool           `json:"status"`
	Data   []NanoPoolData `json:"data"`
}

type NanoPoolData struct {
	BlockNumber int64   `json:"block_number"`
	Hash        string  `json:"hash"`
	Date        int64   `json:"date"`
	Value       float64 `json:"value"`
	Status      int     `json:"status"`
	Miner       string  `json:"miner"`
}

type HashVaultResponseData struct {
	Index        int     `json:"index"`
	Height       int64   `json:"height"`
	Ts           int64   `json:"ts"`
	Hash         string  `json:"hash"`
	Diff         int64   `json:"diff"`
	PoolType     string  `json:"poolType"`
	Hashes       int64   `json:"hashes"`
	Effort       float64 `json:"effort"`
	WalletEffort float64 `json:"walletEffort"`
	WorkerEffort float64 `json:"workerEffort"`
	FoundBy      string  `json:"foundBy"`
	Valid        bool    `json:"valid"`
	Credited     bool    `json:"credited"`
	Value        int64   `json:"value"`
	Elapsed      int64   `json:"elapsed"`
}

type P2PoolResponseData struct {
	Height      int64  `json:"height"`
	Hash        string `json:"hash"`
	Difficulty  int64  `json:"difficulty"`
	TotalHashes int64  `json:"totalHashes"`
	Ts          int64  `json:"ts"` // unix seconds
}

type C3PoolResponseData struct {
	Ts       int64  `json:"ts"`
	Hash     string `json:"hash"`
	Diff     int64  `json:"diff"`
	Shares   int64  `json:"shares"`
	Height   int64  `json:"height"`
	Valid    bool   `json:"valid"`
	Unlocked bool   `json:"unlocked"`
	PoolType string `json:"pool_type"`
	Value    int64  `json:"value"`
}

type MoneroOceanResponseData struct {
	Ts       int64  `json:"ts"`
	Hash     string `json:"hash"`
	Diff     int64  `json:"diff"`
	Shares   int64  `json:"shares"`
	Height   int64  `json:"height"`
	Valid    bool   `json:"valid"`
	Unlocked bool   `json:"unlocked"`
	PoolType string `json:"pool_type"`
	Value    int64  `json:"value"`
}

type XMRPoolResponse struct {
	Pool struct {
		Blocks []string `json:"blocks"`
	} `json:"pool"`
}

type DxPoolResponse struct {
	Items []struct {
		ID         string `json:"id"`
		Puid       int    `json:"puid"`
		WorkerID   string `json:"worker_id"`
		WorkerName string `json:"worker_name"`
		JobID      string `json:"job_id"`
		Height     int64  `json:"height"`
		IsOrphaned int    `json:"is_orphaned"`
		Hash       string `json:"hash"`
		Rewards    string `json:"rewards"`
		Fees       string `json:"fees"`
		Size       int    `json:"size"`
		PrevHash   string `json:"prev_hash"`
		Bits       string `json:"bits"`
		Version    int    `json:"version"`
		Timestamp  int64  `json:"timestamp"`
		CreatedAt  string `json:"created_at"`
		UpdatedAt  string `json:"updated_at"`
	} `json:"items"`
	TotalCount int `json:"total_count"`
}

func GetSupportXmrPoolData() ([]*dbtypes.MultichainPoolDataItem, error) {
	req := &ReqConfig{
		Method:  http.MethodGet,
		HttpUrl: supportXmrURL,
		Payload: map[string]string{
			"limit": "10",
		},
	}
	var responseData []SupportXmrResponseData
	if err := HttpRequest(req, &responseData); err != nil {
		return nil, err
	}
	result := make([]*dbtypes.MultichainPoolDataItem, 0)
	for _, resData := range responseData {
		// reward
		rewardInt, err := strconv.ParseInt(resData.Value, 0, 64)
		if err != nil {
			log.Errorf("XMR: GetSupportXmrPoolData parse reward failed: %v", err)
			continue
		}
		shares, err := strconv.ParseInt(resData.Shares, 0, 64)
		if err != nil {
			log.Errorf("XMR: GetSupportXmrPoolData parse shares failed: %v", err)
			continue
		}
		diff, err := strconv.ParseInt(resData.Diff, 0, 64)
		if err != nil {
			log.Errorf("XMR: GetSupportXmrPoolData parse diff failed: %v", err)
			continue
		}
		effort := float64(0)
		if diff > 0 {
			effort = 100 * float64(shares) / float64(diff)
		}
		reward := utils.AtomicToXMR(uint64(rewardInt))
		result = append(result, &dbtypes.MultichainPoolDataItem{
			BlockHeight: resData.Height,
			PoolName:    poolName[SUPPORTXMR],
			PoolSlug:    SUPPORTXMR,
			Link:        "https://www.supportxmr.com",
			Reward:      reward,
			Health:      effort,
		})
	}
	return result, nil
}

func GetNanoPoolData() ([]*dbtypes.MultichainPoolDataItem, error) {
	req := &ReqConfig{
		Method:  http.MethodGet,
		HttpUrl: nanoPoolURL,
		Payload: map[string]string{},
		Header:  map[string]string{},
	}
	var responseData NanoPoolResponse
	if err := HttpRequest(req, &responseData); err != nil {
		return nil, err
	}
	if !responseData.Status {
		return nil, fmt.Errorf("get pools info from nano pool failed")
	}
	result := make([]*dbtypes.MultichainPoolDataItem, 0)
	for _, resData := range responseData.Data {
		// reward
		result = append(result, &dbtypes.MultichainPoolDataItem{
			BlockHeight: resData.BlockNumber,
			PoolName:    poolName[NANOPOOL],
			PoolSlug:    NANOPOOL,
			Link:        "https://xmr.nanopool.org",
			Reward:      resData.Value,
			Miner:       resData.Miner,
		})
	}
	return result, nil
}

func GetHashVaultPoolData() ([]*dbtypes.MultichainPoolDataItem, error) {
	req := &ReqConfig{
		Method:  http.MethodGet,
		HttpUrl: hashvaultURL,
		Payload: map[string]string{
			"limit": "10",
			"page":  "0",
		},
		Header: map[string]string{},
	}
	var responseData []HashVaultResponseData
	if err := HttpRequest(req, &responseData); err != nil {
		return nil, err
	}
	result := make([]*dbtypes.MultichainPoolDataItem, 0)
	for _, resData := range responseData {
		reward := utils.AtomicToXMR(uint64(resData.Value))
		result = append(result, &dbtypes.MultichainPoolDataItem{
			BlockHeight: resData.Height,
			PoolName:    poolName[HASHVAULT],
			PoolSlug:    HASHVAULT,
			Link:        "https://monero.hashvault.pro",
			Reward:      reward,
			Miner:       resData.FoundBy,
			Health:      resData.Effort,
		})
	}
	return result, nil
}

func GetP2PoolData() ([]*dbtypes.MultichainPoolDataItem, error) {
	req := &ReqConfig{
		Method:  http.MethodGet,
		HttpUrl: p2poolURL,
		Payload: map[string]string{},
		Header:  map[string]string{},
	}
	var responseData []P2PoolResponseData
	if err := HttpRequest(req, &responseData); err != nil {
		return nil, err
	}
	result := make([]*dbtypes.MultichainPoolDataItem, 0)
	for _, resData := range responseData {
		// reward := utils.AtomicToXMR(uint64(resData.Value))
		result = append(result, &dbtypes.MultichainPoolDataItem{
			BlockHeight: resData.Height,
			PoolName:    poolName[P2POOL],
			PoolSlug:    P2POOL,
			Link:        "https://p2pool.io",
		})
	}
	return result, nil
}

func GetC3PoolData() ([]*dbtypes.MultichainPoolDataItem, error) {
	req := &ReqConfig{
		Method:  http.MethodGet,
		HttpUrl: c3poolURL,
		Payload: map[string]string{
			"page":  "0",
			"limit": "10",
		},
		Header: map[string]string{},
	}
	var responseData []C3PoolResponseData
	if err := HttpRequest(req, &responseData); err != nil {
		return nil, err
	}
	result := make([]*dbtypes.MultichainPoolDataItem, 0)
	for _, resData := range responseData {
		reward := utils.AtomicToXMR(uint64(resData.Value))
		effort := float64(0)
		if resData.Diff > 0 {
			effort = 100 * float64(resData.Shares) / float64(resData.Diff)
		}
		result = append(result, &dbtypes.MultichainPoolDataItem{
			BlockHeight: resData.Height,
			PoolName:    poolName[C3POOL],
			PoolSlug:    C3POOL,
			Link:        "https://c3pool.com/#/blockCom",
			Reward:      reward,
			Health:      effort,
		})
	}
	return result, nil
}

func GetMoneroOceanPoolData() ([]*dbtypes.MultichainPoolDataItem, error) {
	req := &ReqConfig{
		Method:  http.MethodGet,
		HttpUrl: moneroOceanURL,
		Payload: map[string]string{
			"page":  "0",
			"limit": "10",
		},
		Header: map[string]string{},
	}
	var responseData []MoneroOceanResponseData
	if err := HttpRequest(req, &responseData); err != nil {
		return nil, err
	}
	result := make([]*dbtypes.MultichainPoolDataItem, 0)
	for _, resData := range responseData {
		reward := utils.AtomicToXMR(uint64(resData.Value))
		effort := float64(0)
		if resData.Diff > 0 {
			effort = 100 * float64(resData.Shares) / float64(resData.Diff)
		}
		result = append(result, &dbtypes.MultichainPoolDataItem{
			BlockHeight: resData.Height,
			PoolName:    poolName[MONEROOCEAN],
			PoolSlug:    MONEROOCEAN,
			Link:        "https://moneroocean.stream",
			Reward:      reward,
			Health:      effort,
		})
	}
	return result, nil
}

func GetXmrPoolData() ([]*dbtypes.MultichainPoolDataItem, error) {
	req := &ReqConfig{
		Method:  http.MethodGet,
		HttpUrl: xmrPoolURL,
		Payload: map[string]string{},
		Header:  map[string]string{},
	}
	var responseData XMRPoolResponse
	if err := HttpRequest(req, &responseData); err != nil {
		return nil, err
	}
	result := make([]*dbtypes.MultichainPoolDataItem, 0)
	for i := 0; i < 20; i += 2 {
		if i >= len(responseData.Pool.Blocks)-1 {
			break
		}
		// info
		info := responseData.Pool.Blocks[i]
		heightStr := responseData.Pool.Blocks[i+1]
		height, err := strconv.ParseInt(heightStr, 0, 64)
		if err != nil {
			log.Errorf("XMR: GetXmrPoolData parse height failed: %v", err)
			continue
		}
		infoArr := strings.Split(info, ":")
		if len(infoArr) < 6 {
			log.Errorf("xmr: GetXmrPoolData info array less than 6 items")
			continue
		}
		diff, err := strconv.ParseInt(infoArr[2], 0, 64)
		if err != nil {
			log.Errorf("XMR: GetXmrPoolData parse diff failed: %v", err)
			continue
		}
		shares, err := strconv.ParseInt(infoArr[3], 0, 64)
		if err != nil {
			log.Errorf("XMR: GetXmrPoolData parse shares failed: %v", err)
			continue
		}
		rewardInt, err := strconv.ParseInt(infoArr[5], 0, 64)
		if err != nil {
			log.Errorf("XMR: GetXmrPoolData parse reward failed: %v", err)
			continue
		}
		reward := utils.AtomicToXMR(uint64(rewardInt))
		effort := float64(0)
		if diff > 0 {
			effort = 100 * float64(shares) / float64(diff)
		}
		result = append(result, &dbtypes.MultichainPoolDataItem{
			BlockHeight: height,
			PoolName:    poolName[XMRPOOL],
			PoolSlug:    XMRPOOL,
			Link:        "https://moneroocean.stream",
			Reward:      reward,
			Health:      effort,
		})
	}
	return result, nil
}

func GetHeroMinerPoolData() ([]*dbtypes.MultichainPoolDataItem, error) {
	req := &ReqConfig{
		Method:  http.MethodGet,
		HttpUrl: heroMinersURL,
		Payload: map[string]string{},
		Header:  map[string]string{},
	}
	var responseData XMRPoolResponse
	if err := HttpRequest(req, &responseData); err != nil {
		return nil, err
	}
	result := make([]*dbtypes.MultichainPoolDataItem, 0)
	for i := 0; i < 20; i += 2 {
		if i >= len(responseData.Pool.Blocks)-1 {
			break
		}
		// info
		info := responseData.Pool.Blocks[i]
		heightStr := responseData.Pool.Blocks[i+1]
		height, err := strconv.ParseInt(heightStr, 0, 64)
		if err != nil {
			log.Errorf("XMR: GetHeroMinerPoolData parse height failed: %v", err)
			continue
		}
		infoArr := strings.Split(info, ":")
		if len(infoArr) < 11 {
			log.Errorf("xmr: GetHeroMinerPoolData info array less than 11 items")
			continue
		}
		diff, err := strconv.ParseInt(infoArr[2], 0, 64)
		if err != nil {
			log.Errorf("XMR: GetHeroMinerPoolData parse diff failed: %v", err)
			continue
		}
		shares, err := strconv.ParseInt(infoArr[3], 0, 64)
		if err != nil {
			log.Errorf("XMR: GetHeroMinerPoolData parse shares failed: %v", err)
			continue
		}
		rewardInt, err := strconv.ParseInt(infoArr[7], 0, 64)
		if err != nil {
			log.Errorf("XMR: GetHeroMinerPoolData parse reward failed: %v", err)
			continue
		}
		reward := utils.AtomicToXMR(uint64(rewardInt))
		effort := float64(0)
		if diff > 0 {
			effort = 100 * float64(shares) / float64(diff)
		}
		result = append(result, &dbtypes.MultichainPoolDataItem{
			BlockHeight: height,
			PoolName:    poolName[HEROMINERS],
			PoolSlug:    HEROMINERS,
			Link:        "https://monero.herominers.com",
			Reward:      reward,
			Health:      effort,
			Miner:       infoArr[8],
		})
	}
	return result, nil
}

func GetMoneroHashPoolData() ([]*dbtypes.MultichainPoolDataItem, error) {
	client := &http.Client{}
	req, err := http.NewRequest(http.MethodGet, moneroHashURL, nil)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "Go-http-client")
	// tránh server nén quá nhiều loại, chỉ xin gzip/deflate
	req.Header.Set("Accept-Encoding", "gzip, deflate")

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var reader io.ReadCloser
	encoding := resp.Header.Get("Content-Encoding")
	switch {
	case strings.Contains(encoding, "gzip"):
		reader, err = gzip.NewReader(resp.Body)
		if err != nil {
			return nil, err
		}
		defer reader.Close()
	case strings.Contains(encoding, "deflate"):
		reader = flate.NewReader(resp.Body)
		defer reader.Close()
	default:
		reader = resp.Body
	}

	var responseData XMRPoolResponse
	if err := json.NewDecoder(reader).Decode(&responseData); err != nil {
		return nil, err
	}
	result := make([]*dbtypes.MultichainPoolDataItem, 0)
	for i := 0; i < 20; i += 2 {
		if i >= len(responseData.Pool.Blocks)-1 {
			break
		}
		// info
		info := responseData.Pool.Blocks[i]
		heightStr := responseData.Pool.Blocks[i+1]
		height, err := strconv.ParseInt(heightStr, 0, 64)
		if err != nil {
			continue
		}
		infoArr := strings.Split(info, ":")
		if len(infoArr) < 6 {
			continue
		}
		diff, err := strconv.ParseInt(infoArr[2], 0, 64)
		if err != nil {
			continue
		}
		shares, err := strconv.ParseInt(infoArr[3], 0, 64)
		if err != nil {
			continue
		}
		rewardInt, err := strconv.ParseInt(infoArr[5], 0, 64)
		if err != nil {
			continue
		}
		reward := utils.AtomicToXMR(uint64(rewardInt))
		effort := float64(0)
		if diff > 0 {
			effort = 100 * float64(shares) / float64(diff)
		}
		result = append(result, &dbtypes.MultichainPoolDataItem{
			BlockHeight: height,
			PoolName:    poolName[MONEROHASH],
			PoolSlug:    MONEROHASH,
			Link:        "https://monerohash.com",
			Reward:      reward,
			Health:      effort,
		})
	}
	return result, nil
}

func GetDxPoolData() ([]*dbtypes.MultichainPoolDataItem, error) {
	req, err := http.NewRequest(http.MethodGet, dxPoolURL, nil)
	if err != nil {
		return nil, err
	}
	// Header giống browser
	req.Header.Set("Accept", "application/json, text/plain, */*")
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36")
	req.Header.Set("Accept-Encoding", "gzip") // chỉ xin gzip, dễ xử lý

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var reader io.ReadCloser
	if strings.Contains(resp.Header.Get("Content-Encoding"), "gzip") {
		reader, err = gzip.NewReader(resp.Body)
		if err != nil {
			return nil, err
		}
		defer reader.Close()
	} else {
		reader = resp.Body
	}

	var responseData DxPoolResponse
	if err := json.NewDecoder(reader).Decode(&responseData); err != nil {
		return nil, err
	}
	result := make([]*dbtypes.MultichainPoolDataItem, 0)
	for _, resData := range responseData.Items {
		reward, err := strconv.ParseFloat(resData.Rewards, 64)
		if err != nil {
			continue
		}
		result = append(result, &dbtypes.MultichainPoolDataItem{
			BlockHeight: resData.Height,
			PoolName:    poolName[DXPOOL],
			PoolSlug:    DXPOOL,
			Link:        "https://www.dxpool.com/pool/xmr/stat",
			Reward:      reward,
			Miner:       resData.WorkerName,
		})
	}
	return result, nil
}

// get 10 last blocks pool
func GetXMRLastBlocksPool() ([]*dbtypes.MultichainPoolDataItem, error) {
	log.Debugf("XMR: Start get block pools data with APIs")
	// get last pool blocks from supportxmr
	totalRes, err := GetSupportXmrPoolData()
	if err != nil {
		totalRes = make([]*dbtypes.MultichainPoolDataItem, 0)
		log.Errorf("XMR: get supportxmr pool list failed: %v", err)
	}
	// get last pool blocks from NanoPool
	nanoPoolRes, err := GetNanoPoolData()
	if err == nil {
		totalRes = append(totalRes, nanoPoolRes...)
	} else {
		log.Errorf("XMR: get nanopool list failed: %v", err)
	}
	// get last pool blocks from HashVault
	hashvaultRes, err := GetHashVaultPoolData()
	if err == nil {
		totalRes = append(totalRes, hashvaultRes...)
	} else {
		log.Errorf("XMR: get hashVault pool list failed: %v", err)
	}
	// get last pool blocks from p2pool
	p2poolRes, err := GetP2PoolData()
	if err == nil {
		totalRes = append(totalRes, p2poolRes...)
	} else {
		log.Errorf("XMR: get p2pool list failed: %v", err)
	}
	// get last pool blocks from c3pool
	c3poolRes, err := GetC3PoolData()
	if err == nil {
		totalRes = append(totalRes, c3poolRes...)
	} else {
		log.Errorf("XMR: get c3pool list failed: %v", err)
	}
	// get last pool blocks from moneroOcean
	moneroOceanRes, err := GetMoneroOceanPoolData()
	if err == nil {
		totalRes = append(totalRes, moneroOceanRes...)
	} else {
		log.Errorf("XMR: get moneroOcean pool list failed: %v", err)
	}
	// get last pool blocks from xmrpool
	xmrpoolRes, err := GetXmrPoolData()
	if err == nil {
		totalRes = append(totalRes, xmrpoolRes...)
	} else {
		log.Errorf("XMR: get xmrpool list failed: %v", err)
	}
	// get last pool blocks from herominners
	herominersRes, err := GetHeroMinerPoolData()
	if err == nil {
		totalRes = append(totalRes, herominersRes...)
	} else {
		log.Errorf("XMR: get herominers pool list failed: %v", err)
	}
	// get last pool blocks from monerohash
	moneroHashRes, err := GetMoneroHashPoolData()
	if err == nil {
		totalRes = append(totalRes, moneroHashRes...)
	} else {
		log.Errorf("XMR: get monerohash pool list failed: %v", err)
	}
	// get last pool blocks from dxpool
	dxPoolRes, err := GetDxPoolData()
	if err == nil {
		totalRes = append(totalRes, dxPoolRes...)
	} else {
		log.Errorf("XMR: get dxpool pool list failed: %v", err)
	}
	sort.Slice(totalRes, func(i, j int) bool {
		return totalRes[i].BlockHeight > totalRes[j].BlockHeight
	})
	if len(totalRes) <= 10 {
		return totalRes, nil
	}
	log.Debugf("XMR: Finish get block pools data with APIs")
	return totalRes[:10], nil
}
