package notification

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

type rpcRequest struct {
	JSONRPC string      `json:"jsonrpc"`
	ID      string      `json:"id"`
	Method  string      `json:"method"`
	Params  interface{} `json:"params,omitempty"`
}

type rpcResponse struct {
	Result json.RawMessage `json:"result"`
	Error  *struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

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

// ---------- Notifier Types ----------

type NewBlock struct {
	Height   uint64
	Hash     string
	TxHashes []string
}

type XmrNotifier struct {
	Endpoint   string
	Interval   time.Duration
	LastHeight uint64
	NewBlocks  chan NewBlock
	NewTxs     chan string
}

// ---------- Constructor ----------

func NewXmrNotifier(endpoint string, interval time.Duration) *XmrNotifier {
	n := &XmrNotifier{
		Endpoint:  endpoint,
		Interval:  interval,
		NewBlocks: make(chan NewBlock, 10),
		NewTxs:    make(chan string, 100),
	}

	// Get current block height to start from tip
	var bc BlockCountResult
	if err := n.callRPC("get_block_count", nil, &bc); err != nil {
		fmt.Println("Init notifier error:", err)
		n.LastHeight = 0 // fallback
	} else {
		n.LastHeight = bc.Count // start from tip
	}

	return n
}

// ---------- Helpers ----------

func (n *XmrNotifier) callRPC(method string, params interface{}, out interface{}) error {
	reqBody, _ := json.Marshal(rpcRequest{
		JSONRPC: "2.0",
		ID:      "0",
		Method:  method,
		Params:  params,
	})
	resp, err := http.Post(n.Endpoint, "application/json", bytes.NewReader(reqBody))
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	var rpcResp rpcResponse
	if err := json.NewDecoder(resp.Body).Decode(&rpcResp); err != nil {
		return err
	}
	if rpcResp.Error != nil {
		return fmt.Errorf("rpc error: %s", rpcResp.Error.Message)
	}
	return json.Unmarshal(rpcResp.Result, out)
}

// ---------- Main Loop ----------

func (n *XmrNotifier) Start() {
	ticker := time.NewTicker(n.Interval)
	for range ticker.C {
		var bc BlockCountResult
		if err := n.callRPC("get_block_count", nil, &bc); err != nil {
			fmt.Println("Error:", err)
			continue
		}

		if bc.Count > n.LastHeight {
			for h := n.LastHeight; h < bc.Count; h++ {
				var br BlockResult
				if err := n.callRPC("get_block", BlockHeaderByHeightParams{Height: h}, &br); err != nil {
					fmt.Println("Error fetching block:", err)
					continue
				}

				var hdr BlockHeaderResult
				if err := n.callRPC("get_block_header_by_height", BlockHeaderByHeightParams{Height: h}, &hdr); err != nil {
					fmt.Println("Error fetching header:", err)
					continue
				}

				// merge miner_tx + tx_hashes
				allTxs := []string{}
				if br.MinerTxHash != "" {
					allTxs = append(allTxs, br.MinerTxHash)
				}
				allTxs = append(allTxs, br.TxHashes...)

				blk := NewBlock{
					Height:   hdr.BlockHeader.Height,
					Hash:     hdr.BlockHeader.Hash,
					TxHashes: allTxs,
				}
				n.NewBlocks <- blk

				for _, tx := range blk.TxHashes {
					n.NewTxs <- tx
				}
			}
			n.LastHeight = bc.Count
		}
	}
}
