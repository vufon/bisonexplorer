package xmrutil

import "encoding/json"

type BlockCountResult struct {
	Count uint64 `json:"count"`
}

type BlockHeaderByHeightParams struct {
	Height uint64 `json:"height"`
}

type BlockHeaderResult struct {
	BlockHeader struct {
		Hash   string `json:"hash"`
		Height uint64 `json:"height"`
	} `json:"block_header"`
}

type BlockResult struct {
	Blob        string   `json:"blob"`
	Json        string   `json:"json"`
	MinerTxHash string   `json:"miner_tx_hash"`
	TxHashes    []string `json:"tx_hashes"`
}

type BlockHeader struct {
	Depth                uint64      `json:"depth"`
	Difficulty           json.Number `json:"difficulty"`                      // may be number or string in JSON
	CumulativeDifficulty json.Number `json:"cumulative_difficulty,omitempty"` // often very large -> string
	Hash                 string      `json:"hash"`
	Height               uint64      `json:"height"`
	MajorVersion         uint32      `json:"major_version"`
	MinorVersion         uint32      `json:"minor_version"`
	Nonce                uint64      `json:"nonce"`
	OrphanStatus         bool        `json:"orphan_status"`
	PrevHash             string      `json:"prev_hash"`
	Reward               uint64      `json:"reward"`
	Timestamp            uint64      `json:"timestamp"`

	// Optional / variant fields (may appear depending on monerod version)
	PowAlgo       string `json:"pow_algo,omitempty"`
	DifficultyNum string `json:"difficulty_num,omitempty"` // sometimes present as string (precise)
}

type BlockData struct {
	Header         BlockHeader
	Connections    int
	BlockchainInfo BlockchainInfo
	ExtraInfo      ExtraInfo
	TxHashes       []string
}

type BlockchainInfo struct {
	Height                    uint64 `json:"height"`
	HeightWithoutBootstrap    uint64 `json:"height_without_bootstrap"`
	TargetHeight              uint64 `json:"target_height"`
	TopHash                   string `json:"top_block_hash"`
	Difficulty                uint64 `json:"difficulty"`
	DifficultyTop64           uint64 `json:"difficulty_top64"`
	CumulativeDifficulty      uint64 `json:"cumulative_difficulty"`
	CumulativeDifficultyTop64 uint64 `json:"cumulative_difficulty_top64"`
	WideDifficulty            string `json:"wide_difficulty"`
	WideCumulativeDifficulty  string `json:"wide_cumulative_difficulty"`

	Target            uint64 `json:"target"` // target block time in seconds
	TxCount           uint64 `json:"tx_count"`
	TxPoolSize        uint64 `json:"tx_pool_size"`
	BlockSizeLimit    uint64 `json:"block_size_limit"`
	BlockSizeMedian   uint64 `json:"block_size_median"`
	BlockWeightLimit  uint64 `json:"block_weight_limit"`
	BlockWeightMedian uint64 `json:"block_weight_median"`

	IncomingConnections int `json:"incoming_connections_count"`
	OutgoingConnections int `json:"outgoing_connections_count"`
	RpcConnections      int `json:"rpc_connections_count"`
	GreyPeerlistSize    int `json:"grey_peerlist_size"`
	WhitePeerlistSize   int `json:"white_peerlist_size"`

	BootstrapDaemonAddress string `json:"bootstrap_daemon_address"`
	WasBootstrapEverUsed   bool   `json:"was_bootstrap_ever_used"`

	AdjustedTime int64  `json:"adjusted_time"`
	StartTime    int64  `json:"start_time"`
	FreeSpace    uint64 `json:"free_space"`
	DatabaseSize uint64 `json:"database_size"`

	Mainnet      bool   `json:"mainnet"`
	Testnet      bool   `json:"testnet"`
	Stagenet     bool   `json:"stagenet"`
	Nettype      string `json:"nettype"`
	Restricted   bool   `json:"restricted"`
	Offline      bool   `json:"offline"`
	BusySyncing  bool   `json:"busy_syncing"`
	Synchronized bool   `json:"synchronized"`
	Untrusted    bool   `json:"untrusted"`

	AltBlocksCount uint64 `json:"alt_blocks_count"`

	UpdateAvailable bool   `json:"update_available"`
	Version         string `json:"version"`
	Status          string `json:"status"`
}

type ExtraInfo struct {
	TxLen int
}

type MempoolTx struct {
	IDHash        string `json:"id_hash,omitempty"`
	BlobSize      int64  `json:"blob_size,omitempty"`
	FormattedSize string `json:"formattedSize,omitempty"`
	Fee           int64  `json:"fee,omitempty"`
	TxJSON        string `json:"tx_json,omitempty"`
	ReceiveTime   uint64 `json:"receive_time,omitempty"`
	Relayed       bool   `json:"relayed,omitempty"`
	KeptByBlock   bool   `json:"kept_by_block,omitempty"`
	DoubleSpend   bool   `json:"double_spend_seen,omitempty"`
	LastFailed    string `json:"last_failed_reason,omitempty"`
}

type Mempool struct {
	TxCount      int         `json:"tx_count"`
	BytesTotal   int64       `json:"bytes_total"`
	OldestTx     uint64      `json:"oldest_tx"`
	Transactions []MempoolTx `json:"transactions"`
	TotalFee     int64       `json:"total_fee"`
	OutputsCount int64       `json:"outputs_count"`
	MinFeeRate   float64     `json:"min_fee_rate"`
	MaxFeeRate   float64     `json:"max_fee_rate"`
	Status       string      `json:"status"`
}

type Transaction struct {
	Vout []struct {
		Amount uint64 `json:"amount"`
		Target struct {
			Key string `json:"key"`
		} `json:"target"`
	} `json:"vout"`

	RctSignatures struct {
		Type   int    `json:"type"`
		TxnFee uint64 `json:"txnFee"`
	} `json:"rct_signatures"`
}

type PoolHisto struct {
	Bytes int64 `json:"bytes"`
	Txs   int64 `json:"txs"`
}

// Main PoolStats
type PoolStats struct {
	BytesMax        int64       `json:"bytes_max"`
	BytesMed        int64       `json:"bytes_med"`
	BytesMin        int64       `json:"bytes_min"`
	BytesTotal      int64       `json:"bytes_total"`
	FeeTotal        int64       `json:"fee_total"`
	Histo           []PoolHisto `json:"histo"`
	Histo98pc       int64       `json:"histo_98pc"`
	Num10m          int64       `json:"num_10m"`
	NumDoubleSpends int64       `json:"num_double_spends"`
	NumFailing      int64       `json:"num_failing"`
	NumNotRelayed   int64       `json:"num_not_relayed"`
	Oldest          int64       `json:"oldest"`
	TxsTotal        int64       `json:"txs_total"`
}

// Response from /get_transaction_pool_stats
type GetTransactionPoolStatsResponse struct {
	Credits   int64     `json:"credits"`
	PoolStats PoolStats `json:"pool_stats"`
	Status    string    `json:"status"`
	TopHash   string    `json:"top_hash"`
	Untrusted bool      `json:"untrusted"`
}

type GetOutsResult struct {
	Credits   uint64       `json:"credits"`
	Outs      []OutputInfo `json:"outs"`
	Status    string       `json:"status"`
	TopHash   string       `json:"top_hash"`
	Untrusted bool         `json:"untrusted"`
}

type OutputInfo struct {
	Height   int64  `json:"height"`
	Key      string `json:"key"`  // Stealth address
	Mask     string `json:"mask"` // Commitment mask (RingCT)
	TxID     string `json:"txid"` // Transaction hash
	Unlocked bool   `json:"unlocked"`
}
