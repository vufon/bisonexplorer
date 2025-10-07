package xmrclient

import (
	"bytes"
	"context"
	"crypto/sha1"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

type ProveByTxKeyResult struct {
	Received      uint64 // atomic units (piconero)
	InPool        bool
	Confirmations uint64
}

type DecodedTx struct {
	Txid          string `json:"txid"`
	Fee           uint64 `json:"fee"`
	Amount        uint64 `json:"amount"`
	Confirmations uint64 `json:"confirmations"`
}

type rpcRequest struct {
	Jsonrpc string      `json:"jsonrpc"`
	ID      string      `json:"id"`
	Method  string      `json:"method"`
	Params  interface{} `json:"params,omitempty"`
}

type rpcResponse struct {
	Jsonrpc string          `json:"jsonrpc"`
	ID      string          `json:"id"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

func walletFilesExist(walletFilesDir, walletFilename string) bool {
	// check <walletFilename>.keys (the keys file always created)
	keysPath := filepath.Join(walletFilesDir, walletFilename+".keys")
	if _, err := os.Stat(keysPath); err == nil {
		return true
	}
	// some older setups may have different pattern; check any match walletFilename*
	pattern := filepath.Join(walletFilesDir, walletFilename+"*")
	matches, _ := filepath.Glob(pattern)
	return len(matches) > 0
}

func callWalletRPC(ctx context.Context, rpcURL, rpcAuth, method string, params interface{}) (json.RawMessage, error) {
	// Build rpc request body
	reqBody := rpcRequest{"2.0", "0", method, params}
	b, err := json.Marshal(reqBody)
	if err != nil {
		return nil, err
	}

	// Normalize rpcURL: accept base like http://127.0.0.1:18083 or full /json_rpc
	if !strings.HasSuffix(rpcURL, "/json_rpc") && !strings.HasSuffix(rpcURL, "/json_rpc/") {
		if strings.HasSuffix(rpcURL, "/") {
			rpcURL = rpcURL + "json_rpc"
		} else {
			rpcURL = rpcURL + "/json_rpc"
		}
	}

	// Build curl args. Use --digest only if rpcAuth provided.
	var args []string
	args = append(args, "-s", "-S") // silent but show errors
	if rpcAuth != "" {
		args = append(args, "--digest", "-u", rpcAuth)
	}
	args = append(args,
		"-X", "POST",
		rpcURL,
		"-H", "Content-Type: application/json",
		"--data-binary", "@-",
	)

	// exec curl with ctx so it respects timeouts/cancel
	cmd := exec.CommandContext(ctx, "curl", args...)
	cmd.Stdin = bytes.NewReader(b)

	// capture combined output (stdout+stderr) for debugging
	out, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("curl exec error: %v, output: %s", err, strings.TrimSpace(string(out)))
	}

	// decode response: it should be JSON-RPC
	var r rpcResponse
	if err := json.Unmarshal(out, &r); err != nil {
		// return body for debugging if not JSON
		return nil, fmt.Errorf("failed to decode wallet-rpc response: %v; body: %s", err, strings.TrimSpace(string(out)))
	}
	if r.Error != nil {
		return nil, fmt.Errorf("wallet-rpc error %d: %s", r.Error.Code, r.Error.Message)
	}
	return r.Result, nil
}

func makeWatchWalletFilename(address, viewKey string) string {
	h := sha1.Sum([]byte(viewKey))
	shortHash := fmt.Sprintf("%x", h)[:12]
	shortAddr := address
	if len(shortAddr) > 12 {
		shortAddr = shortAddr[:12]
	}
	return fmt.Sprintf("watch_%s_%s_%d", shortAddr, shortHash, time.Now().UnixNano())
}

func ensureWalletOpenWithDir(ctx context.Context, rpcURL, rpcAuth, walletFilesDir, walletName string) error {
	if walletName == "" {
		return errors.New("walletName required to ensure wallet open")
	}
	if walletFilesDir == "" {
		return errors.New("walletFilesDir required")
	}

	// If the file appears to be present on disk, prefer open_wallet; else try create_wallet.
	// Note: open_wallet uses filename relative to wallet-dir configured in monero-wallet-rpc.
	existsOnDisk := false
	// quick check: look for any file that starts with walletName in walletFilesDir
	pattern := filepath.Join(walletFilesDir, walletName+"*")
	if matches, _ := filepath.Glob(pattern); len(matches) > 0 {
		existsOnDisk = true
	}

	// Try open_wallet first
	_, err := callWalletRPC(ctx, rpcURL, rpcAuth, "open_wallet", map[string]interface{}{
		"filename": walletName,
		"password": "",
	})
	if err == nil {
		return nil
	}
	errStr := strings.ToLower(err.Error())

	// treat "already open" as OK
	if strings.Contains(errStr, "is open in another process") || strings.Contains(errStr, "wallet is already open") {
		return nil
	}

	// if file not found or not exists — try create_wallet
	if strings.Contains(errStr, "file not found") ||
		strings.Contains(errStr, "no such file") ||
		strings.Contains(errStr, "wallet file not found") ||
		strings.Contains(errStr, "wallet file does not exist") || !existsOnDisk {

		// create_wallet (will create under the wallet-dir configured in the RPC)
		_, createErr := callWalletRPC(ctx, rpcURL, rpcAuth, "create_wallet", map[string]interface{}{
			"filename": walletName,
			"password": "",
			"language": "English",
		})
		if createErr != nil {
			return fmt.Errorf("create_wallet failed: %v (original open error: %v)", createErr, err)
		}
		// create_wallet normally opens it; still call open to be safe
		_, openErr := callWalletRPC(ctx, rpcURL, rpcAuth, "open_wallet", map[string]interface{}{
			"filename": walletName,
			"password": "",
		})
		if openErr != nil {
			return fmt.Errorf("open_wallet after create failed: %v", openErr)
		}
		return nil
	}

	// otherwise return original error
	return fmt.Errorf("open_wallet failed: %v", err)
}

func parseUintFromInterface(v interface{}) (uint64, error) {
	switch t := v.(type) {
	case float64:
		return uint64(t), nil
	case int:
		return uint64(t), nil
	case int64:
		return uint64(t), nil
	case uint64:
		return t, nil
	case json.Number:
		n, err := t.Int64()
		if err != nil {
			return 0, err
		}
		return uint64(n), nil
	case string:
		// attempt parse decimal string
		var num json.Number = json.Number(t)
		n, err := num.Int64()
		if err != nil {
			return 0, err
		}
		return uint64(n), nil
	default:
		return 0, fmt.Errorf("unsupported number type: %T", v)
	}
}

// safeBool tries to interpret a value as bool
func safeBool(v interface{}) bool {
	if v == nil {
		return false
	}
	switch b := v.(type) {
	case bool:
		return b
	case string:
		return b == "true"
	case float64:
		return b != 0
	default:
		return false
	}
}

func DecodeOutputs(
	ctx context.Context,
	rpcURL, rpcAuth, walletFilesDir,
	address, viewKey, txid string,
	txHeight, margin uint64,
	pollTimeout time.Duration,
) (result *DecodedTx, retErr error) {

	// Named returns used so defer cleanup can append errors.
	// Basic validation
	if address == "" || viewKey == "" {
		return nil, errors.New("address and viewKey are required")
	}
	if txid == "" {
		return nil, errors.New("txid is required")
	}
	if walletFilesDir == "" {
		return nil, errors.New("walletFilesDir is required and must match monero-wallet-rpc --wallet-dir")
	}

	walletFilename := makeWatchWalletFilename(address, viewKey)

	// compute restore_height safely
	var restoreHeight uint64
	if txHeight == 0 {
		restoreHeight = 0
	} else {
		if margin > 10000 {
			margin = 100
		}
		if txHeight <= margin {
			restoreHeight = 0
		} else {
			restoreHeight = txHeight - margin
		}
	}

	// Cleanup function: wipe ALL CONTENTS under walletFilesDir (but not the dir itself).
	allowWipeHome := false // set true only if you really want to allow wiping $HOME
	cleanup := func() error {
		abs, err := filepath.Abs(walletFilesDir)
		if err != nil {
			return fmt.Errorf("cleanup: cannot resolve abs path: %w", err)
		}
		// safety guards
		if abs == "/" {
			return fmt.Errorf("cleanup: refusing to wipe root '/'")
		}
		if home, _ := os.UserHomeDir(); !allowWipeHome && home != "" && abs == home {
			return fmt.Errorf("cleanup: refusing to wipe user home directory %q (set allowWipeHome=true to override)", home)
		}
		if len(abs) < 4 {
			return fmt.Errorf("cleanup: path %q too short, refusing to wipe", abs)
		}

		// best-effort close_wallet
		shortCtx2, cancel2 := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel2()
		_, _ = callWalletRPC(shortCtx2, rpcURL, rpcAuth, "close_wallet", nil)

		// Remove all entries in dir
		entries, err := os.ReadDir(abs)
		if err != nil {
			return fmt.Errorf("cleanup: ReadDir failed for %q: %w", abs, err)
		}
		for _, e := range entries {
			p := filepath.Join(abs, e.Name())
			if err := os.RemoveAll(p); err != nil {
				return fmt.Errorf("cleanup: RemoveAll failed for %q: %w", p, err)
			}
		}
		// ensure dir exists
		if err := os.MkdirAll(abs, 0700); err != nil {
			return fmt.Errorf("cleanup: MkdirAll failed for %q: %w", abs, err)
		}
		log.Printf("cleanup: wiped contents of %q", abs)
		return nil
	}

	// Ensure cleanup runs before function returns and merges errors properly.
	defer func() {
		if cerr := cleanup(); cerr != nil {
			if retErr != nil {
				retErr = fmt.Errorf("%v; cleanup error: %v", retErr, cerr)
			} else {
				retErr = fmt.Errorf("cleanup error: %v", cerr)
			}
		}
	}()

	// short context for open/generate attempts
	shortCtx, cancelShort := context.WithTimeout(ctx, 10*time.Second)
	defer cancelShort()

	// Try open or generate (we don't fail hard here)
	existsBefore := walletFilesExist(walletFilesDir, walletFilename)
	if existsBefore {
		_, _ = callWalletRPC(shortCtx, rpcURL, rpcAuth, "open_wallet", map[string]interface{}{"filename": walletFilename, "password": ""})
	} else {
		genParams := map[string]interface{}{
			"restore_height": restoreHeight,
			"filename":       walletFilename,
			"address":        address,
			"view_key":       viewKey,
			"viewkey":        viewKey,
			"spend_key":      "",
			"password":       "",
		}
		if _, genErr := callWalletRPC(shortCtx, rpcURL, rpcAuth, "generate_from_keys", genParams); genErr != nil {
			low := strings.ToLower(genErr.Error())
			if strings.Contains(low, "file already exists") || strings.Contains(low, "already exists") {
				_, _ = callWalletRPC(shortCtx, rpcURL, rpcAuth, "open_wallet", map[string]interface{}{"filename": walletFilename, "password": ""})
			} else {
				_, _ = callWalletRPC(shortCtx, rpcURL, rpcAuth, "open_wallet", map[string]interface{}{"filename": walletFilename, "password": ""})
			}
		}
	}

	// Poll get_transfer_by_txid until found / timeout
	getParams := map[string]interface{}{"txid": txid}
	deadline := time.Now().Add(pollTimeout)
	first := true

	for {
		raw, rpcErr := callWalletRPC(ctx, rpcURL, rpcAuth, "get_transfer_by_txid", getParams)
		if rpcErr == nil {
			// Parse into map[string]json.RawMessage to extract transfer/transfers
			var mm map[string]json.RawMessage
			if err := json.Unmarshal(raw, &mm); err != nil {
				retErr = fmt.Errorf("failed to parse get_transfer_by_txid result: %v", err)
				return nil, retErr
			}

			var transferRaw json.RawMessage
			if v, ok := mm["transfer"]; ok && len(v) > 0 && string(v) != "null" {
				transferRaw = v
			} else if v, ok := mm["transfers"]; ok && len(v) > 0 {
				// try to take first element of transfers array
				var arr []json.RawMessage
				if err := json.Unmarshal(v, &arr); err == nil && len(arr) > 0 {
					transferRaw = arr[0]
				}
			} else {
				// no transfer found yet -> keep polling
				// but if response has other shape, try to fallback by unmarshalling top-level into DecodedTx
				// (rare) -> attempt direct unmarshal
				var direct DecodedTx
				if err := json.Unmarshal(raw, &direct); err == nil && direct.Txid != "" {
					result = &direct
					return result, nil
				}
				// otherwise continue polling
				transferRaw = nil
			}

			if len(transferRaw) > 0 {
				// unmarshal minimal fields into DecodedTx
				var t DecodedTx
				if err := json.Unmarshal(transferRaw, &t); err != nil {
					// if numeric types mismatch, try intermediate map extraction as fallback
					var im map[string]interface{}
					if err2 := json.Unmarshal(transferRaw, &im); err2 != nil {
						retErr = fmt.Errorf("failed to parse transfer payload: %v; fallback parse error: %v", err, err2)
						return nil, retErr
					}
					// extract carefully
					if s, ok := im["txid"].(string); ok {
						t.Txid = s
					}
					if v, ok := im["fee"].(float64); ok {
						t.Fee = uint64(v)
					} else if v, ok := im["fee"].(json.Number); ok {
						if u, e := v.Int64(); e == nil {
							t.Fee = uint64(u)
						}
					}
					if v, ok := im["amount"].(float64); ok {
						t.Amount = uint64(v)
					}
					if v, ok := im["confirmations"].(float64); ok {
						t.Confirmations = uint64(v)
					}
				}
				result = &t
				return result, nil
			}
		} else {
			low := strings.ToLower(rpcErr.Error())
			if strings.Contains(low, "no wallet file") || strings.Contains(low, "wallet file not found") {
				retErr = rpcErr
				return nil, retErr
			}
			// else swallow and retry
		}

		if pollTimeout == 0 && !first {
			break
		}
		first = false
		if pollTimeout == 0 || time.Now().After(deadline) {
			break
		}
		select {
		case <-time.After(2 * time.Second):
		case <-ctx.Done():
			retErr = ctx.Err()
			return nil, retErr
		}
	}

	// final attempt
	rawLast, lastErr := callWalletRPC(ctx, rpcURL, rpcAuth, "get_transfer_by_txid", getParams)
	if lastErr != nil {
		retErr = fmt.Errorf("get_transfer_by_txid final attempt failed: %v", lastErr)
		return nil, retErr
	}
	// parse final
	var mm map[string]json.RawMessage
	if err := json.Unmarshal(rawLast, &mm); err != nil {
		retErr = fmt.Errorf("failed to parse final get_transfer_by_txid result: %v", err)
		return nil, retErr
	}
	var transferRaw json.RawMessage
	if v, ok := mm["transfer"]; ok && len(v) > 0 && string(v) != "null" {
		transferRaw = v
	} else if v, ok := mm["transfers"]; ok && len(v) > 0 {
		var arr []json.RawMessage
		if err := json.Unmarshal(v, &arr); err == nil && len(arr) > 0 {
			transferRaw = arr[0]
		}
	}
	if len(transferRaw) == 0 {
		// Try direct unmarshal into DecodedTx
		var direct DecodedTx
		if err := json.Unmarshal(rawLast, &direct); err == nil && direct.Txid != "" {
			result = &direct
			return result, nil
		}
		retErr = fmt.Errorf("final result contains no transfer")
		return nil, retErr
	}

	var t DecodedTx
	if err := json.Unmarshal(transferRaw, &t); err != nil {
		// fallback map extraction
		var im map[string]interface{}
		if err2 := json.Unmarshal(transferRaw, &im); err2 != nil {
			retErr = fmt.Errorf("failed to parse final transfer payload: %v; fallback error: %v", err, err2)
			return nil, retErr
		}
		if s, ok := im["txid"].(string); ok {
			t.Txid = s
		}
		if v, ok := im["fee"].(float64); ok {
			t.Fee = uint64(v)
		}
		if v, ok := im["amount"].(float64); ok {
			t.Amount = uint64(v)
		}
		if v, ok := im["confirmations"].(float64); ok {
			t.Confirmations = uint64(v)
		}
	}

	result = &t
	return result, nil
}

func ProveByTxKey(
	ctx context.Context,
	rpcURL, rpcAuth, walletFilesDir,
	txid, txKey, address string,
) (*ProveByTxKeyResult, error) {

	// basic validation
	if txid == "" || txKey == "" || address == "" {
		return nil, errors.New("txid, txKey and address are required")
	}
	if walletFilesDir == "" {
		return nil, errors.New("walletFilesDir is required and must match monero-wallet-rpc --wallet-dir")
	}

	walletName := makeWatchWalletFilename(address, txKey)
	// walletName may be empty -> fallback to env/default inside ensureWalletOpenWithDir

	// cleanup function: wipes ALL CONTENTS under walletFilesDir (synchronous)
	// safety: refuse to wipe "/" or $HOME unless allowWipeHome=true
	allowWipeHome := false
	cleanup := func() error {
		abs, err := filepath.Abs(walletFilesDir)
		if err != nil {
			return fmt.Errorf("cleanup: cannot resolve abs path: %w", err)
		}
		if abs == "/" {
			return fmt.Errorf("cleanup: refusing to wipe root '/'")
		}
		if home, _ := os.UserHomeDir(); !allowWipeHome && home != "" && abs == home {
			return fmt.Errorf("cleanup: refusing to wipe user home directory %q (set allowWipeHome=true to override)", home)
		}
		if len(abs) < 4 {
			return fmt.Errorf("cleanup: path %q too short, refusing to wipe", abs)
		}

		// best-effort close wallet so files can be removed
		shortCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_, _ = callWalletRPC(shortCtx, rpcURL, rpcAuth, "close_wallet", nil)

		entries, err := os.ReadDir(abs)
		if err != nil {
			return fmt.Errorf("cleanup: ReadDir failed for %q: %w", abs, err)
		}
		for _, e := range entries {
			p := filepath.Join(abs, e.Name())
			if err := os.RemoveAll(p); err != nil {
				return fmt.Errorf("cleanup: RemoveAll failed for %q: %w", p, err)
			}
		}
		// ensure dir exists (recreate if necessary)
		if err := os.MkdirAll(abs, 0700); err != nil {
			return fmt.Errorf("cleanup: MkdirAll failed for %q: %w", abs, err)
		}
		log.Printf("cleanup: wiped contents of %q", abs)
		return nil
	}

	// Ensure cleanup runs synchronously before function returns and errors are propagated.
	var retErr error
	defer func() {
		if cerr := cleanup(); cerr != nil {
			if retErr != nil {
				retErr = fmt.Errorf("%v; cleanup error: %v", retErr, cerr)
			} else {
				retErr = fmt.Errorf("cleanup error: %v", cerr)
			}
		}
	}()

	// Ensure wallet open using walletFilesDir context (this helper uses open/create RPCs).
	if walletName == "" {
		// fallback: env var or default name
		walletName = os.Getenv("MONERO_WALLET_PROVE_NAME")
		if walletName == "" {
			walletName = "prove_wallet"
		}
	}

	if err := ensureWalletOpenWithDir(ctx, rpcURL, rpcAuth, walletFilesDir, walletName); err != nil {
		retErr = fmt.Errorf("ensure wallet open failed: %v", err)
		return nil, retErr
	}

	// give wallet-rpc a short settle time
	time.Sleep(250 * time.Millisecond)

	// prepare params & call check_tx_key (like before)
	params := map[string]interface{}{
		"txid":    txid,
		"tx_key":  txKey,
		"address": address,
	}

	raw, err := callWalletRPC(ctx, rpcURL, rpcAuth, "check_tx_key", params)
	if err != nil {
		retErr = fmt.Errorf("check_tx_key rpc error: %w", err)
		return nil, retErr
	}

	// parse result
	var m map[string]interface{}
	if err := json.Unmarshal(raw, &m); err != nil {
		retErr = fmt.Errorf("failed to unmarshal check_tx_key result: %w", err)
		return nil, retErr
	}

	var res ProveByTxKeyResult
	if v, ok := m["received"]; ok {
		if val, err := parseUintFromInterface(v); err == nil {
			res.Received = val
		}
	}
	if v, ok := m["in_pool"]; ok {
		res.InPool = safeBool(v)
	}
	if v, ok := m["confirmations"]; ok {
		if val, err := parseUintFromInterface(v); err == nil {
			res.Confirmations = val
		}
	}
	return &res, nil
}
