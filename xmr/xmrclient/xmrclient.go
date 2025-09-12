package xmrclient

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/decred/dcrdata/v8/xmr/xmrutil"
)

// XMRClient is a simple JSON-RPC + direct-endpoint client for monerod.
type XMRClient struct {
	endpoint string
	httpCli  *http.Client
	// baseURL is endpoint without trailing "/json_rpc", used for direct endpoints.
	baseURL  string
	Username string // nếu daemon yêu cầu basic auth (thường không)
	Password string
}

// NewXMRClient preserves previous signature and uses 60s timeout.
func NewXMRClient(endpoint string) *XMRClient {
	return NewXMRClientWithTimeout(endpoint, 60*time.Second)
}

// NewXMRClientWithTimeout allows custom http timeout.
func NewXMRClientWithTimeout(endpoint string, timeout time.Duration) *XMRClient {
	// normalize endpoint
	ep := strings.TrimSpace(endpoint)
	// create a transport with reasonable defaults
	tr := &http.Transport{
		Proxy:                 http.ProxyFromEnvironment,
		DialContext:           (&net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
		MaxIdleConns:          100,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
		DisableCompression:    true,
	}
	cli := &http.Client{
		Timeout:   timeout,
		Transport: tr,
	}
	base := ep
	// If endpoint ends with /json_rpc, remove it to get base for direct endpoints
	if strings.HasSuffix(strings.ToLower(base), "/json_rpc") {
		base = base[:len(base)-len("/json_rpc")]
	}
	return &XMRClient{
		endpoint: ep,
		httpCli:  cli,
		baseURL:  strings.TrimRight(base, "/"),
	}
}

// internal rpc wrapper for JSON-RPC methods under /json_rpc
func (c *XMRClient) callRPC(method string, params interface{}, out interface{}) error {
	reqBody, _ := json.Marshal(map[string]interface{}{
		"jsonrpc": "2.0",
		"id":      "0",
		"method":  method,
		"params":  params,
	})
	resp, err := c.httpCli.Post(c.endpoint, "application/json", bytes.NewReader(reqBody))
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	// decode wrapper
	var rpcResp struct {
		Result json.RawMessage `json:"result"`
		Error  *struct {
			Code    int    `json:"code"`
			Message string `json:"message"`
		} `json:"error,omitempty"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rpcResp); err != nil {
		// try to read body for debug
		return fmt.Errorf("decode rpc response: %v", err)
	}
	if rpcResp.Error != nil {
		return fmt.Errorf("rpc error: %s", rpcResp.Error.Message)
	}
	if out == nil {
		return nil
	}
	return json.Unmarshal(rpcResp.Result, out)
}

// ---------- Existing helper methods (kept/compatible) ----------

func (c *XMRClient) GetBlockCount() (uint64, error) {
	var res struct {
		Count uint64 `json:"count"`
	}
	err := c.callRPC("get_block_count", nil, &res)
	return res.Count, err
}

func (c *XMRClient) GetConnections() (int, error) {
	var res struct {
		Incoming int `json:"incoming_connections_count"`
		Outgoing int `json:"outgoing_connections_count"`
	}
	err := c.callRPC("get_info", nil, &res)
	if err != nil {
		return 0, err
	}
	return res.Incoming + res.Outgoing, nil
}

func (c *XMRClient) GetBlockHeaderByHeight(height uint64) (*xmrutil.BlockHeader, error) {
	var res struct {
		BlockHeader xmrutil.BlockHeader `json:"block_header"`
	}
	err := c.callRPC("get_block_header_by_height", map[string]uint64{"height": height}, &res)
	return &res.BlockHeader, err
}

func (c *XMRClient) GetBlockHeaderByHash(hash string) (*xmrutil.BlockHeader, error) {
	var res struct {
		BlockHeader xmrutil.BlockHeader `json:"block_header"`
	}
	err := c.callRPC("get_block_header_by_hash", map[string]string{"hash": hash}, &res)
	if err != nil {
		return nil, err
	}
	return &res.BlockHeader, nil
}

func (c *XMRClient) GetBlock(height uint64) (*xmrutil.BlockResult, error) {
	var res xmrutil.BlockResult
	err := c.callRPC("get_block", map[string]uint64{"height": height}, &res)
	return &res, err
}

func (c *XMRClient) GetBlockByHash(hash string) (*xmrutil.BlockResult, error) {
	var res xmrutil.BlockResult
	err := c.callRPC("get_block", map[string]string{"hash": hash}, &res)
	if err != nil {
		return nil, err
	}
	return &res, nil
}

func (c *XMRClient) GetLastBlockHeader() (*xmrutil.BlockHeader, error) {
	var res struct {
		BlockHeader xmrutil.BlockHeader `json:"block_header"`
	}
	err := c.callRPC("get_last_block_header", nil, &res)
	return &res.BlockHeader, err
}

func (c *XMRClient) GetInfo() (*xmrutil.BlockchainInfo, error) {
	var res xmrutil.BlockchainInfo
	err := c.callRPC("get_info", nil, &res)
	return &res, err
}

// ------------------ New additions ------------------

// GetTransactionsResult models the common fields returned by get_transactions.
type GetTransactionsResult struct {
	TxsHashes  []string `json:"txs_hashes,omitempty"`
	TxsAsHex   []string `json:"txs_as_hex,omitempty"`  // raw tx hex per tx
	TxsAsJSON  []string `json:"txs_as_json,omitempty"` // decoded tx JSON per tx (if decode_as_json = true)
	MissedTx   []string `json:"missed_tx,omitempty"`
	Status     string   `json:"status,omitempty"`
	InvalidTxs []string `json:"invalid_txids,omitempty"`
	// note: different monero versions may use slightly different field names;
	// keep this struct tolerant (we use json.Unmarshal which will fill matching fields).
}

// helper: POST tới core endpoint (non-json-rpc)
func (c *XMRClient) postCore(endpoint string, params interface{}, out interface{}) error {
	client := c.httpCli
	if client == nil {
		client = &http.Client{Timeout: 15 * time.Second}
	}

	url := strings.TrimRight(c.baseURL, "/") + "/" + strings.TrimLeft(endpoint, "/")
	bodyBytes, err := json.Marshal(params)
	if err != nil {
		return fmt.Errorf("marshal params: %w", err)
	}

	req, err := http.NewRequest("POST", url, bytes.NewReader(bodyBytes))
	if err != nil {
		return fmt.Errorf("new request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if c.Username != "" {
		req.SetBasicAuth(c.Username, c.Password)
	}

	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("http post: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("daemon returned status %d: %s", resp.StatusCode, string(respBody))
	}

	if err := json.Unmarshal(respBody, out); err != nil {
		return fmt.Errorf("decode response: %w — body: %s", err, string(respBody))
	}
	return nil
}

// GetTransactions calls get_transactions with given hashes. If decodeAsJSON true it will request txs_as_json.
func (c *XMRClient) GetTransactions(hashes []string, decodeAsJSON bool) (*GetTransactionsResult, error) {
	params := map[string]interface{}{
		"txs_hashes":     hashes,
		"decode_as_json": decodeAsJSON,
	}
	var res GetTransactionsResult
	if err := c.postCore("get_transactions", params, &res); err != nil {
		return nil, err
	}
	return &res, nil
}

// ----------------- Direct (non-json_rpc) endpoints for mempool -----------------

// TxPoolEntry models a single entry in the transaction pool (fields commonly used).
type TxPoolEntry struct {
	IDHash      string `json:"id_hash,omitempty"`
	Blob        string `json:"tx_blob,omitempty"`
	TxJSON      string `json:"tx_json,omitempty"`
	ReceiveTime uint64 `json:"receive_time,omitempty"`
	Relayed     bool   `json:"relayed,omitempty"`
	KeptByBlock string `json:"kept_by_block,omitempty"`
	FailReason  string `json:"last_failed_reason,omitempty"`
	// There are other fields; add as needed.
}

type TxPoolResult struct {
	Transactions []TxPoolEntry `json:"transactions,omitempty"`
	PoolSize     int           `json:"pool_size,omitempty"`
	Status       string        `json:"status,omitempty"`
}

// helper to call direct daemon endpoints (POST to /get_transaction_pool etc)
func (c *XMRClient) postDirect(path string, body interface{}, out interface{}) error {
	url := c.baseURL + path
	var buf io.Reader
	if body != nil {
		bb, _ := json.Marshal(body)
		buf = bytes.NewReader(bb)
	} else {
		buf = bytes.NewReader([]byte("{}"))
	}
	resp, err := c.httpCli.Post(url, "application/json", buf)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if out == nil {
		// discard
		_, _ = io.Copy(io.Discard, resp.Body)
		return nil
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

// GetTransactionPool returns full mempool entries (decode_as_json not required)
func (c *XMRClient) GetTransactionPool() (*TxPoolResult, error) {
	var res TxPoolResult
	if err := c.postDirect("/get_transaction_pool", nil, &res); err != nil {
		return nil, err
	}
	return &res, nil
}

// GetTransactionPoolHashes returns only pool hashes (lightweight)
func (c *XMRClient) GetTransactionPoolHashes() ([]string, error) {
	var res struct {
		PoolHashes []string `json:"tx_hashes"` // some versions use tx_hashes
		TxHashes   []string `json:"tx_hashes"`
		Status     string   `json:"status"`
	}
	// endpoint path
	if err := c.postDirect("/get_transaction_pool_hashes", nil, &res); err != nil {
		return nil, err
	}
	// prefer TxHashes then PoolHashes
	if len(res.TxHashes) > 0 {
		return res.TxHashes, nil
	}
	return res.PoolHashes, nil
}

// GetTransactionPoolStats returns pool stats (count/bytes/fees)
func (c *XMRClient) GetTransactionPoolStats() (map[string]interface{}, error) {
	var res map[string]interface{}
	if err := c.postDirect("/get_transaction_pool_stats", nil, &res); err != nil {
		return nil, err
	}
	return res, nil
}
