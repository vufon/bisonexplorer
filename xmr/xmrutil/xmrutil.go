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
	Height       uint64 `json:"height"`
	TargetHeight uint64 `json:"target_height"`
	TopHash      string `json:"top_block_hash"`
	Difficulty   uint64 `json:"difficulty"`
	Incoming     int    `json:"incoming_connections_count"`
	Outgoing     int    `json:"outgoing_connections_count"`
	Status       string `json:"status"`
}

type ExtraInfo struct {
	TxLen int
}
