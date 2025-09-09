package xmrclient

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/decred/dcrdata/v8/xmr/xmrutil"
)

type XMRClient struct {
	endpoint string
	httpCli  *http.Client
}

func NewXMRClient(endpoint string) *XMRClient {
	return &XMRClient{
		endpoint: endpoint,
		httpCli:  &http.Client{Timeout: 60 * time.Second},
	}
}

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

	var rpcResp struct {
		Result json.RawMessage `json:"result"`
		Error  *struct {
			Code    int    `json:"code"`
			Message string `json:"message"`
		} `json:"error,omitempty"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rpcResp); err != nil {
		return err
	}
	if rpcResp.Error != nil {
		return fmt.Errorf("rpc error: %s", rpcResp.Error.Message)
	}
	return json.Unmarshal(rpcResp.Result, out)
}

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
