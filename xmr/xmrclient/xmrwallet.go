package xmrclient

import (
	"bytes"
	"context"
	"crypto/sha1"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math/big"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"filippo.io/edwards25519"
	"golang.org/x/crypto/sha3"
)

type ProveByTxKeyResult struct {
	Received      uint64 `json:"received"`
	InPool        bool   `json:"inPool"`
	Confirmations uint64 `json:"confirmations"`
}

type DecodedTx struct {
	Txid               string         `json:"txid"`
	Fee                uint64         `json:"fee"`
	Amount             uint64         `json:"amount"`
	Confirmations      uint64         `json:"confirmations"`
	Address            string         `json:"address,omitempty"`
	OwnedOutputIndices []int          `json:"ownedOutputIndices"`
	PerOutputAmounts   map[int]uint64 `json:"perOutputAmounts"`
	SubaddrMajor       int64          `json:"subaddr_major,omitempty"`
	SubaddrMinor       int64          `json:"subaddr_minor,omitempty"`
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

func ProveByTxKey(
	ctx context.Context,
	rpcURL, rpcAuth, walletFilesDir, walletName,
	txid, txKey, address string,
) (*ProveByTxKeyResult, error) {

	// basic validation
	if txid == "" || txKey == "" || address == "" {
		return nil, errors.New("txid, txKey and address are required")
	}
	if walletFilesDir == "" {
		return nil, errors.New("walletFilesDir is required and must match monero-wallet-rpc --wallet-dir")
	}

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
	// Ensure wallet open using walletFilesDir context (this helper uses open/create RPCs).
	if walletName == "" {
		walletName = "prove_wallet"
	}

	existsBefore := walletFilesExist(walletFilesDir, walletName)
	if existsBefore {
		_, _ = callWalletRPC(ctx, rpcURL, rpcAuth, "open_wallet", map[string]interface{}{"filename": walletName, "password": ""})
	} else {
		if cerr := cleanup(); cerr != nil {
			return nil, cerr
		}
		_, createErr := callWalletRPC(ctx, rpcURL, rpcAuth, "create_wallet", map[string]interface{}{
			"filename": walletName,
			"password": "",
			"language": "English",
		})
		if createErr != nil {
			return nil, fmt.Errorf("create_wallet failed: %v", createErr)
		}
		// create_wallet normally opens it; still call open to be safe
		_, openErr := callWalletRPC(ctx, rpcURL, rpcAuth, "open_wallet", map[string]interface{}{
			"filename": walletName,
			"password": "",
		})
		if openErr != nil {
			return nil, fmt.Errorf("open_wallet after create failed: %v", openErr)
		}
	}

	// give wallet-rpc a short settle time
	time.Sleep(200 * time.Millisecond)

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

// func MatchOwnedOutputs(extraHex string, outKeys []string, address string, viewKeyHex string) ([]int, error) {
// 	if address == "" || viewKeyHex == "" {
// 		return nil, errors.New("address and viewKeyHex required")
// 	}
// 	// 1) Parse address -> B (public spend key)
// 	addr, err := ParseAddress(address)
// 	if err != nil {
// 		return nil, fmt.Errorf("parse address: %w", err)
// 	}
// 	Bpoint, err := bytesToPoint(addr.PublicSpendKey)
// 	if err != nil {
// 		return nil, fmt.Errorf("invalid public spend key in address: %w", err)
// 	}

// 	// 2) Parse view key scalar a
// 	aBytes, err := hex.DecodeString(viewKeyHex)
// 	if err != nil || len(aBytes) != 32 {
// 		return nil, fmt.Errorf("invalid viewKey hex (need 32 bytes): %w", err)
// 	}
// 	a := new(edwards25519.Scalar)
// 	if _, err := a.SetUniformBytes(aBytes); err != nil {
// 		return nil, fmt.Errorf("set scalar(viewKey): %w", err)
// 	}

// 	// 3) Parse tx.extra to get R / additional R_i
// 	te, err := ParseTxExtra(extraHex) // your existing function
// 	if err != nil {
// 		return nil, fmt.Errorf("ParseTxExtra: %w", err)
// 	}
// 	if te.TxPublicKey == "" && len(te.AdditionalPubkeys) == 0 {
// 		return nil, errors.New("tx.extra contains no tx public key(s)")
// 	}
// 	// Base R (used when no additional per-output pubkey)
// 	var baseR *edwards25519.Point
// 	if te.TxPublicKey != "" {
// 		rb, _ := hex.DecodeString(te.TxPublicKey)
// 		baseR, err = bytesToPoint(rb)
// 		if err != nil {
// 			return nil, fmt.Errorf("TxPublicKey invalid: %w", err)
// 		}
// 	}

// 	// 4) Iterate outputs and test membership
// 	indices := make([]int, 0, 2)
// 	for i, keyHex := range outKeys {
// 		PiBytes, err := hex.DecodeString(keyHex)
// 		if err != nil || len(PiBytes) != 32 {
// 			return nil, fmt.Errorf("vout[%d]: invalid key hex", i)
// 		}
// 		Pi, err := bytesToPoint(PiBytes)
// 		if err != nil {
// 			return nil, fmt.Errorf("vout[%d]: invalid point: %w", i, err)
// 		}

// 		// pick R_used: additional[i] if present else base R
// 		var R *edwards25519.Point
// 		if i < len(te.AdditionalPubkeys) && te.AdditionalPubkeys[i] != "" {
// 			rb, _ := hex.DecodeString(te.AdditionalPubkeys[i])
// 			R, err = bytesToPoint(rb)
// 			if err != nil {
// 				return nil, fmt.Errorf("additional_pubkey[%d] invalid: %w", i, err)
// 			}
// 		} else {
// 			R = baseR
// 		}
// 		if R == nil {
// 			// No key available to derive for this index
// 			continue
// 		}

// 		// D = a * R
// 		D := new(edwards25519.Point).ScalarMult(a, R) // point on curve

// 		// s = Hs( D || varint_le(i) )
// 		s, err := hashToScalar(append(D.Bytes(), encodeVarintLE(uint64(i))...))
// 		if err != nil {
// 			return nil, fmt.Errorf("vout[%d]: hashToScalar: %w", i, err)
// 		}

// 		// P' = s*G + B
// 		sG := new(edwards25519.Point).ScalarBaseMult(s)
// 		Pprime := new(edwards25519.Point).Add(sG, Bpoint)

// 		if bytesEqual(Pprime.Bytes(), Pi.Bytes()) {
// 			indices = append(indices, i)
// 		}
// 	}
// 	return indices, nil
// }

type ParsedAddress struct {
	NetworkTag     byte   // mainnet: 0x12 (standard), 0x2a (subaddress), etc.
	PublicSpendKey []byte // 32B
	PublicViewKey  []byte // 32B
	// (integrated address also has 8B payment id after these 64 bytes; not needed here)
}

func ParseAddress(addr string) (*ParsedAddress, error) {
	raw, err := moneroBase58Decode(addr)
	if err != nil {
		return nil, err
	}
	// Minimal formats we accept:
	// - Standard/Subaddress/Integrated:
	//   [1B tag][32B spend][32B view][maybe 8B pid][4B checksum]
	if len(raw) < 1+32+32+4 {
		return nil, errors.New("address payload too short")
	}
	// Verify checksum (Keccak-256, first 4 bytes)
	body := raw[:len(raw)-4]
	cs := raw[len(raw)-4:]
	k := sha3.NewLegacyKeccak256()
	_, _ = k.Write(body)
	sum := k.Sum(nil)
	if !bytesEqual(sum[:4], cs) {
		return nil, errors.New("address checksum mismatch")
	}

	tag := body[0]
	spend := make([]byte, 32)
	view := make([]byte, 32)
	copy(spend, body[1:1+32])
	copy(view, body[1+32:1+32+32])

	return &ParsedAddress{
		NetworkTag:     tag,
		PublicSpendKey: spend,
		PublicViewKey:  view,
	}, nil
}

func bytesEqual(a, b []byte) bool {
	if len(a) != len(b) {
		return false
	}
	ok := byte(1)
	for i := range a {
		ok &= a[i] ^ b[i]
	}
	return ok == 0
}

// ----- Monero Base58 (block-wise) -----

var ed25519Order *big.Int
var b58Alphabet = []byte("123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz")
var b58Index [256]int8

func Init() {
	// l = 2^252 + 27742317777372353535851937790883648493
	ed25519Order = new(big.Int)
	ed25519Order.SetString("723700557733226221397318656304299424085711635937990760600195093828545425857", 10)
	for i := range b58Index {
		b58Index[i] = -1
	}
	for i, c := range b58Alphabet {
		b58Index[c] = int8(i)
	}
}

func moneroBase58Decode(s string) ([]byte, error) {
	if s == "" {
		return nil, errors.New("empty address")
	}
	// Monero encodes in 8-byte blocks -> 11 chars; final block smaller.
	const fullBlockSize = 8
	const fullEncodedSize = 11

	var out []byte
	for len(s) > 0 {
		// Determine block size for this chunk
		remain := len(s)
		var encBlockLen, decBlockLen int
		if remain >= fullEncodedSize {
			encBlockLen = fullEncodedSize
			decBlockLen = fullBlockSize
		} else {
			encBlockLen = remain
			// map encoded length to decoded length per Monero rules
			// (see src/common/base58.cpp); table for last block:
			switch encBlockLen {
			case 1:
				decBlockLen = 0
			case 2:
				decBlockLen = 1
			case 3:
				decBlockLen = 2
			case 4:
				decBlockLen = 3
			case 5:
				decBlockLen = 4
			case 6:
				decBlockLen = 5
			case 7:
				decBlockLen = 6
			case 8:
				decBlockLen = 7
			case 9, 10, 11:
				decBlockLen = 8
			default:
				return nil, errors.New("invalid base58 tail length")
			}
		}

		chunk := s[:encBlockLen]
		s = s[encBlockLen:]

		// Base58 decode chunk (big-endian base58 to big integer buffer)
		num := make([]byte, 0, decBlockLen+1) // base256 big-endian
		for i := 0; i < encBlockLen; i++ {
			c := chunk[i]
			v := -1
			if c < 128 {
				v = int(b58Index[c])
			}
			if v < 0 {
				return nil, fmt.Errorf("invalid base58 char %q", c)
			}
			carry := v
			for j := len(num) - 1; j >= 0; j-- {
				carry += int(num[j]) * 58
				num[j] = byte(carry & 0xFF)
				carry >>= 8
			}
			for carry > 0 {
				num = append([]byte{byte(carry & 0xFF)}, num...)
				carry >>= 8
			}
		}
		// num now has big-endian bytes; pad to decBlockLen
		if len(num) > decBlockLen {
			// Leading zeros handling: keep the rightmost decBlockLen bytes
			num = num[len(num)-decBlockLen:]
		} else if len(num) < decBlockLen {
			pad := make([]byte, decBlockLen-len(num))
			num = append(pad, num...)
		}
		out = append(out, num...)
	}
	return out, nil
}

func fetchTxFromDaemon(txJSONStr string) (extraHex string, outKeys, eAmtHex, eMaskHex []string, err error) {
	var txExtra interface{}
	if txJSONStr != "" {
		// store parsed JSONB for easier queries
		var tmp map[string]interface{}
		if err := json.Unmarshal([]byte(txJSONStr), &tmp); err == nil {
			txExtra = tmp
		} else {
			// fallback: store raw string
			txExtra = txJSONStr
		}
	}
	outKeys = make([]string, 0)
	if txExtra != nil {
		switch v := txExtra.(type) {
		case map[string]interface{}:
			if voutsIf, ok := v["vout"].([]interface{}); ok {
				for _, vo := range voutsIf {
					if voMap, ok := vo.(map[string]interface{}); ok {
						// target may be under "target" -> "key"
						if target, ok2 := voMap["target"].(map[string]interface{}); ok2 {
							if taggedKey, ok3 := target["tagged_key"].(map[string]interface{}); ok3 {
								if k, ok4 := taggedKey["key"].(string); ok4 {
									outKeys = append(outKeys, k)
								}
							} else if k, ok3 := target["key"].(string); ok3 {
								outKeys = append(outKeys, k)
							}
						}
					}
				}
			}
			// fees / outputs / total sent: sometimes present in tx JSON
			if extraIf, ok := v["extra"].([]interface{}); ok {
				var extraBytes []byte
				for _, val := range extraIf {
					switch v := val.(type) {
					case float64:
						extraBytes = append(extraBytes, byte(v))
					case int:
						extraBytes = append(extraBytes, byte(v))
					default:
						continue
					}
				}
				extraHex = hex.EncodeToString(extraBytes)
			} else if extraStr, ok := v["extra"].(string); ok {
				extraHex = extraStr
			} else {
				return "", nil, nil, nil, fmt.Errorf("get extra hex failed")
			}
			if rct, ok := v["rct_signatures"].(map[string]interface{}); ok {
				if ecdh, ok := rct["ecdhInfo"].([]interface{}); ok {
					for _, it := range ecdh {
						m, _ := it.(map[string]interface{})
						if s, ok := m["amount"].(string); ok {
							eAmtHex = append(eAmtHex, s)
						}
						if s, ok := m["mask"].(string); ok {
							eMaskHex = append(eMaskHex, s)
						}
					}
				} else {
					// một số daemon field là "ecdhInfo": [] với size = len(vout)
					return "", nil, nil, nil, errors.New("tx JSON has no rct_signatures.ecdhInfo[]")
				}
			} else {
				return "", nil, nil, nil, errors.New("tx JSON has no rct_signatures")
			}
		}
	}
	return
}

func MatchOwnedOutputsWithB(te *XmrTxExtra, extraHex string, outKeys []string, Bused *edwards25519.Point, a *edwards25519.Scalar) ([]ownedOut, error) {
	// R candidates
	var Rcands []*edwards25519.Point
	if te.TxPublicKey != "" {
		rb, _ := hex.DecodeString(te.TxPublicKey)
		if p, e := bytesToPoint(rb); e == nil {
			Rcands = append(Rcands, p)
		}
	}
	for _, h := range te.AdditionalPubkeys {
		if h == "" {
			continue
		}
		b, _ := hex.DecodeString(h)
		if p, e := bytesToPoint(b); e == nil {
			Rcands = append(Rcands, p)
		}
	}
	if len(Rcands) == 0 {
		return nil, errors.New("no tx pubkey in extra")
	}

	fmt.Println("txpub base:", te.TxPublicKey, " addls:", len(te.AdditionalPubkeys))
	fmt.Println("vout keys count:", len(outKeys))

	// scalar 8
	var eightBytes [32]byte
	eightBytes[0] = 8
	eight := edwards25519.NewScalar()
	if _, err := eight.SetCanonicalBytes(eightBytes[:]); err != nil {
		return nil, fmt.Errorf("set scalar 8: %w", err)
	}

	owned := make([]ownedOut, 0, 2)
	for i, okhex := range outKeys {
		PiB, err := hex.DecodeString(okhex)
		if err != nil || len(PiB) != 32 {
			continue
		}
		Pi, err := bytesToPoint(PiB)
		if err != nil {
			continue
		}
		fmt.Printf("varint(%d) = % x\n", i, moneroVarint(uint64(i)))
		matched := false
		for _, R := range Rcands {
			// D8 = 8 * (a * R)
			Dpoint := new(edwards25519.Point).ScalarMult(a, R)
			D8 := new(edwards25519.Point).ScalarMult(eight, Dpoint)
			Dbytes := D8.Bytes()

			// s := Hs(D8 || varint(i))
			payload := append(Dbytes, moneroVarint(uint64(i))...)
			s := hashToScalarHs(payload)

			// P' = s*G + Bused
			sG := new(edwards25519.Point).ScalarBaseMult(s)
			Pprime := new(edwards25519.Point).Add(sG, Bused)

			if bytes.Equal(Pprime.Bytes(), Pi.Bytes()) {
				fmt.Println("matched vout", i, "with base/additional R")
				owned = append(owned, ownedOut{Index: i, RUsed: R})
				matched = true
				break
			}
			// Fallback hiếm: s2 = Hs(Keccak(D8||i))
			s2 := hashToScalarHs(keccak256(payload))
			P2 := new(edwards25519.Point).Add(new(edwards25519.Point).ScalarBaseMult(s2), Bused)
			if bytes.Equal(P2.Bytes(), Pi.Bytes()) {
				fmt.Println("matched vout", i, "with R (fallback s2)")
				owned = append(owned, ownedOut{Index: i, RUsed: R})
				matched = true
				break
			}
			// Fallback idx=0:
			payload0 := append(Dbytes, moneroVarint(0)...)
			s0 := hashToScalarHs(payload0)
			P0 := new(edwards25519.Point).Add(new(edwards25519.Point).ScalarBaseMult(s0), Bused)
			if bytes.Equal(P0.Bytes(), Pi.Bytes()) {
				fmt.Println("fallback idx=0 matched vout", i)
				owned = append(owned, ownedOut{Index: i, RUsed: R})
				matched = true
				break
			}
		}

		if !matched && i < 2 && len(Rcands) > 0 {
			// debug sâu: in P' với Rcands[0]
			Dpoint := new(edwards25519.Point).ScalarMult(a, Rcands[0])
			D8 := new(edwards25519.Point).ScalarMult(eight, Dpoint)
			payload := append(D8.Bytes(), moneroVarint(uint64(i))...)
			sdbg := hashToScalarHs(payload)
			Pdbg := new(edwards25519.Point).Add(new(edwards25519.Point).ScalarBaseMult(sdbg), Bused)
			fmt.Printf("dbg i=%d P'=%x Pi=%s\n", i, Pdbg.Bytes(), okhex)
		}
	}
	return owned, nil
}

func moneroVarint(x uint64) []byte {
	out := make([]byte, 0, 10)
	for {
		b := byte(x & 0x7F)
		x >>= 7
		if x == 0 {
			out = append(out, b) // byte cuối: bit 7 = 0
			break
		}
		out = append(out, b|0x80) // còn nữa: bit 7 = 1
	}
	return out
}

func debugDumpTxExtraTags(hexExtra string) {
	b, _ := hex.DecodeString(hexExtra)
	n := len(b)
	i := 0
	readVar := func() (int, error) {
		val, shift := 0, 0
		for {
			if i >= n {
				return 0, fmt.Errorf("varint truncated")
			}
			c := int(b[i])
			i++
			val |= (c & 0x7F) << shift
			if (c & 0x80) == 0 {
				break
			}
			shift += 7
		}
		return val, nil
	}
	fmt.Printf("tx_extra len=%d\n", n)
	for i < n {
		tag := b[i]
		i++
		switch tag {
		case 0x00:
			fmt.Println("tag 00 (padding)")
		case 0x01:
			if i+32 > n {
				fmt.Println("tag 01 truncated")
				return
			}
			fmt.Printf("tag 01 tx_pubkey=%x\n", b[i:i+32])
			i += 32
		case 0x02:
			L, err := readVar()
			if err != nil {
				fmt.Println("tag 02 varint err:", err)
				return
			}
			if i+L > n {
				fmt.Println("tag 02 truncated")
				return
			}
			fmt.Printf("tag 02 extra_nonce len=%d (first=%02x)\n", L, b[i])
			i += L
		case 0x03:
			L, err := readVar()
			if err != nil {
				fmt.Println("tag 03 varint err:", err)
				return
			}
			if i+L > n {
				fmt.Println("tag 03 truncated")
				return
			}
			fmt.Printf("tag 03 merge-mining len=%d\n", L)
			i += L
		case 0x04:
			L, err := readVar()
			if err != nil {
				fmt.Println("tag 04 varint err:", err)
				return
			}
			if i+L > n {
				fmt.Println("tag 04 truncated")
				return
			}
			cnt := L / 32
			fmt.Printf("tag 04 additional_pubkeys bytes=%d cnt=%d\n", L, cnt)
			for k := 0; k < cnt; k++ {
				fmt.Printf("  R[%d]=%x\n", k, b[i+k*32:i+(k+1)*32])
			}
			i += L
		default:
			L, err := readVar()
			if err != nil {
				fmt.Printf("tag %02x varint err: %v\n", tag, err)
				return
			}
			if i+L > n {
				fmt.Printf("tag %02x truncated need %d\n", tag, L)
				return
			}
			fmt.Printf("tag %02x len=%d (skipped)\n", tag, L)
			i += L
		}
	}
}

func tryMatchWithB(
	te *XmrTxExtra,
	outOneTimeKeys []string, // list of vout public keys (P)
	Rcands []*edwards25519.Point,
	B *edwards25519.Point, // public spend key (standard or subaddress)
	a *edwards25519.Scalar, // private view key
	debug bool,
) ([]ownedOut, int, error) {

	var owned []ownedOut

	// Try 3 derivation variants
	for variant := 1; variant <= 3; variant++ {
		owned = owned[:0] // reset

		for i, Phex := range outOneTimeKeys {
			Pb, err := hex.DecodeString(Phex)
			if err != nil || len(Pb) != 32 {
				continue
			}
			P, err := bytesToPoint(Pb)
			if err != nil {
				continue
			}

			var derivedP *edwards25519.Point
			var Rused *edwards25519.Point
			var found bool

			switch variant {
			case 1: // Standard: P = Hs(R || i) * B + a*G
				for _, R := range Rcands {
					derived := deriveOneTimeKeyV1(R, B, a, uint64(i))
					if derived.Equal(P) == 1 {
						derivedP = derived
						Rused = R
						found = true
						break
					}
				}
			case 2: // Subaddress V2: P = Hs(a*R || i) * G + B
				for _, R := range Rcands {
					derived := deriveOneTimeKeyV2(R, B, a, uint64(i))
					if derived.Equal(P) == 1 {
						derivedP = derived
						Rused = R
						found = true
						break
					}
				}
			case 3: // Subaddress V3 (rare): P = Hs(R || a*B || i) * G + B
				for _, R := range Rcands {
					derived := deriveOneTimeKeyV3(R, B, a, uint64(i))
					if derived.Equal(P) == 1 {
						derivedP = derived
						Rused = R
						found = true
						break
					}
				}
			}

			if found {
				owned = append(owned, ownedOut{
					Index:    i,
					RUsed:    Rused,
					DerivedP: derivedP,
				})
				if debug {
					fmt.Printf("  [variant %d] MATCH vout[%d] with R=%s\n", variant, i, hex.EncodeToString(Rused.Bytes()))
				}
			}
		}

		if len(owned) > 0 {
			return owned, variant, nil
		}
	}

	return nil, 0, fmt.Errorf("no output matched with any derivation variant")
}

func deriveOneTimeKeyV2(R, B *edwards25519.Point, a *edwards25519.Scalar, outputIndex uint64) *edwards25519.Point {
	// P = Hs(a*R || index) * G + B

	// 1. aR = a * R
	var aR edwards25519.Point
	aR.ScalarMult(a, R)

	// 2. Hs(aR ||#index)
	var buf [40]byte
	copy(buf[:32], aR.Bytes())
	binary.LittleEndian.PutUint64(buf[32:], outputIndex)
	h := keccak256(buf[:])

	var hs edwards25519.Scalar
	hs.SetBytesWithClamping(h)

	// 3. hs * G
	var term1 edwards25519.Point
	term1.ScalarBaseMult(&hs)

	// 4. P = term1 + B
	var result edwards25519.Point
	result.Add(&term1, B)

	return &result
}

func deriveOneTimeKeyV3(R, B *edwards25519.Point, a *edwards25519.Scalar, outputIndex uint64) *edwards25519.Point {
	// P = Hs(R || a*B || index) * G + B

	// 1. aB = a * B
	var aB edwards25519.Point
	aB.ScalarMult(a, B)

	// 2. Hs(R || aB || index)
	var buf [72]byte
	copy(buf[:32], R.Bytes())
	copy(buf[32:64], aB.Bytes())
	binary.LittleEndian.PutUint64(buf[64:], outputIndex)
	h := keccak256(buf[:])

	var hs edwards25519.Scalar
	hs.SetBytesWithClamping(h)

	// 3. hs * G
	var term1 edwards25519.Point
	term1.ScalarBaseMult(&hs)

	// 4. P = term1 + B
	var result edwards25519.Point
	result.Add(&term1, B)

	return &result
}

func deriveOneTimeKeyV1(R, B *edwards25519.Point, a *edwards25519.Scalar, outputIndex uint64) *edwards25519.Point {
	// P = Hs(R || output_index) * B + a * G

	// 1. Hs(R || index)
	var buf [40]byte
	copy(buf[:32], R.Bytes())
	binary.LittleEndian.PutUint64(buf[32:], outputIndex)
	h := keccak256(buf[:])

	var hs edwards25519.Scalar
	hs.SetBytesWithClamping(h)

	// 2. term1 = hs * B
	var term1 edwards25519.Point
	term1.ScalarMult(&hs, B)

	// 3. term2 = a * G
	var term2 edwards25519.Point
	term2.ScalarBaseMult(a)

	// 4. P = term1 + term2
	var result edwards25519.Point
	result.Add(&term1, &term2)

	return &result
}

type ownedOut struct {
	Index    int
	RUsed    *edwards25519.Point
	DerivedP *edwards25519.Point
}

func DecodeOutputs(
	ctx context.Context,
	rpcURL, rpcAuth, walletFilesDir,
	address, viewKey, txid, txJSONStr string,
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

	// short context for open/generate attempts
	shortCtx, cancelShort := context.WithTimeout(ctx, 10*time.Second)
	defer cancelShort()
	// Try open or generate (we don't fail hard here)
	existsBefore := walletFilesExist(walletFilesDir, walletFilename)
	if existsBefore {
		_, _ = callWalletRPC(shortCtx, rpcURL, rpcAuth, "open_wallet", map[string]interface{}{"filename": walletFilename, "password": ""})
	} else {
		if cerr := cleanup(); cerr != nil {
			return nil, cerr
		}
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
				// best-effort open even if generate errors (some wrappers return non-fatal errors)
				_, _ = callWalletRPC(shortCtx, rpcURL, rpcAuth, "open_wallet", map[string]interface{}{"filename": walletFilename, "password": ""})
			}
		}
	}

	// Give the wallet-rpc a brief moment to start scanning after open/generate.
	// This reduces "Transaction not found" spuriously returned while scan hasn't started.
	select {
	case <-time.After(1500 * time.Millisecond):
	case <-ctx.Done():
		retErr = ctx.Err()
		return nil, retErr
	}

	// Poll get_transfer_by_txid until found / timeout
	getParams := map[string]interface{}{"txid": txid}
	deadline := time.Now().Add(pollTimeout)
	first := true

	var t DecodedTx
	found := false

	for {
		raw, rpcErr := callWalletRPC(ctx, rpcURL, rpcAuth, "get_transfer_by_txid", getParams)

		// If RPC returned an immediate error that indicates missing wallet file -> fail fast
		if rpcErr != nil {
			low := strings.ToLower(rpcErr.Error())
			if strings.Contains(low, "no wallet file") || strings.Contains(low, "wallet file not found") {
				retErr = rpcErr
				return nil, retErr
			}
			// For other errors (including "transaction not found"), do NOT treat them as definitive:
			// wallet may still be scanning or transient RPC state. We'll log and retry until timeout.
			log.Printf("get_transfer_by_txid transient error (will retry): %v", rpcErr)
		} else {
			// Try to detect top-level "error" in the RPC response. If present and not the typical "transaction not found" message,
			// consider it fatal. But be conservative: many wrappers embed transient msg inside "error" too.
			var top map[string]json.RawMessage
			if err := json.Unmarshal(raw, &top); err == nil {
				if eRaw, ok := top["error"]; ok && len(eRaw) > 0 && string(eRaw) != "null" {
					// inspect the error payload textually
					el := strings.ToLower(strings.TrimSpace(string(eRaw)))
					// If it's definitely not a transient "transaction not found", return it.
					if !strings.Contains(el, "transaction not found") && !strings.Contains(el, "not found") {
						retErr = fmt.Errorf("wallet rpc error: %s", strings.TrimSpace(string(eRaw)))
						return nil, retErr
					}
					// otherwise treat as transient and continue retrying
					log.Printf("get_transfer_by_txid reported not-found (will retry): %s", strings.TrimSpace(string(eRaw)))
				}
			}

			// Parse into map[string]json.RawMessage to extract transfer/transfers
			var mm map[string]json.RawMessage
			if err := json.Unmarshal(raw, &mm); err != nil {
				// If parsing fails, that's likely fatal
				retErr = fmt.Errorf("failed to parse get_transfer_by_txid result: %v", err)
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
			} else {
				transferRaw = nil
			}

			if len(transferRaw) > 0 {
				// unmarshal minimal fields into DecodedTx (KHÔNG return sớm nữa)
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
					if adr, ok := im["address"].(string); ok && adr != "" {
						t.Address = adr
					} else if addrs, ok := im["addresses"].([]interface{}); ok && len(addrs) > 0 {
						if adr0, ok := addrs[0].(string); ok {
							t.Address = adr0
						}
					}
					var maj, min int64
					if sai, ok := im["subaddr_index"].(map[string]interface{}); ok {
						if v, ok2 := sai["major"].(float64); ok2 {
							maj = int64(v)
						}
						if v, ok2 := sai["minor"].(float64); ok2 {
							min = int64(v)
						}
						t.SubaddrMajor = maj
						t.SubaddrMinor = min
					}
				}
				found = true
				break // THOÁT vòng lặp, đi làm decode per-output phía dưới
			}
			// else: no transfer in response -> continue polling
		}

		// Breaking conditions / wait
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

	// final attempt (chỉ khi chưa tìm thấy trong vòng lặp)
	if !found {
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
		fmt.Println("transferRaw")
		if len(transferRaw) == 0 {
			// Try direct unmarshal into DecodedTx
			var direct DecodedTx
			if err := json.Unmarshal(rawLast, &direct); err == nil && direct.Txid != "" {
				t = direct
				found = true
			} else {
				retErr = fmt.Errorf("final result contains no transfer")
				return nil, retErr
			}
		} else {
			// unmarshal vào t
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
				if adr, ok := im["address"].(string); ok && adr != "" {
					t.Address = adr
				} else if addrs, ok := im["addresses"].([]interface{}); ok && len(addrs) > 0 {
					if adr0, ok := addrs[0].(string); ok {
						t.Address = adr0
					}
				}
			}
			found = true
		}
	} else {
		// để giữ nguyên debug như bạn đang có
		fmt.Println("transferRaw")
	}

	// Nếu tới đây vẫn chưa found, return lỗi
	if !found {
		return nil, fmt.Errorf("transaction not found by wallet-rpc within timeout")
	}

	// Gán vào result để các nhánh sau có thể return sớm vẫn có data
	result = &t
	fmt.Println("check result ok: ", result.Amount)

	vkBytes, err := hex.DecodeString(viewKey)
	if err != nil || len(vkBytes) != 32 {
		fmt.Println("warn: viewKey hex invalid")
		return result, nil
	}
	a := edwards25519.NewScalar()
	if _, err := a.SetCanonicalBytes(vkBytes); err != nil {
		fmt.Println("warn: viewKey not canonical: ", err)
		return result, nil
	}

	// --- Lấy vật liệu RingCT + xác định outputs thuộc về bạn + giải mã amount từng output ---
	extraHex, outOneTimeKeys, ecdhAmtC, ecdhMaskC, parseErr := fetchTxFromDaemon(txJSONStr)
	if parseErr != nil {
		fmt.Println("warn: cannot extract RingCT ciphertext from txJSONStr: ", parseErr)
		return result, nil
	}

	fmt.Println("check out keys: ", outOneTimeKeys)
	fmt.Printf("ecdh arrays: amt=%d mask=%d\n", len(ecdhAmtC), len(ecdhMaskC))
	if len(outOneTimeKeys) == 0 {
		fmt.Println("warn: no vout one-time keys in txJSONStr")
		return result, nil
	}

	// 1) Dump tx_extra theo tag để chắc chắn parser không lệch (đặc biệt 0x04)
	debugDumpTxExtraTags(extraHex)

	// 2) Parse tx_extra “chính thống” (dùng varint cho 0x02/0x04)
	te, err := ParseTxExtra(extraHex)
	if err != nil {
		return nil, fmt.Errorf("ParseTxExtra: %w", err)
	}
	fmt.Println("txpub base:", te.TxPublicKey, " addls:", len(te.AdditionalPubkeys))
	if len(te.AdditionalPubkeys) > 0 {
		fmt.Println("R[0]:", te.AdditionalPubkeys[0])
	}

	// 3) Chuẩn bị danh sách R_used candidates
	Rcands := make([]*edwards25519.Point, 0, 1+len(te.AdditionalPubkeys))
	if te.TxPublicKey != "" {
		if rb, _ := hex.DecodeString(te.TxPublicKey); len(rb) == 32 {
			if p, e := bytesToPoint(rb); e == nil {
				Rcands = append(Rcands, p) // base R
			} else {
				fmt.Println("warn: txpub base SetBytes:", e)
			}
		}
	}
	for _, h := range te.AdditionalPubkeys {
		if b, _ := hex.DecodeString(h); len(b) == 32 {
			if p, e := bytesToPoint(b); e == nil {
				Rcands = append(Rcands, p) // additional R_i
			} else {
				fmt.Println("warn: addl R SetBytes:", e)
			}
		}
	}
	fmt.Printf("R candidates count = %d (base + addls)\n", len(Rcands))
	if len(Rcands) == 0 {
		fmt.Println("warn: no R candidates; cannot match outputs")
		return result, nil
	}

	// 4) Chuẩn bị danh sách B_used candidates (theo ưu tiên)
	getBFromAddr := func(addr string) *edwards25519.Point {
		ap, e := ParseAddress(addr)
		if e != nil {
			fmt.Println("getBFromAddr ParseAddress err:", e)
			return nil
		}
		p, e2 := bytesToPoint(ap.PublicSpendKey)
		if e2 != nil {
			fmt.Println("getBFromAddr bytesToPoint err:", e2)
			return nil
		}
		return p
	}
	isStandard := func(addr string) bool { return len(addr) > 0 && addr[0] == '4' }
	isSubAddr := func(addr string) bool { return len(addr) > 0 && addr[0] == '8' }

	type Bcand struct {
		Label string
		B     *edwards25519.Point
	}
	var Bcands []Bcand

	if len(te.AdditionalPubkeys) == 0 {
		// Không có 0x04 → khả năng cao KHÔNG gửi subaddress; ưu tiên standard
		if isStandard(address) {
			if b := getBFromAddr(address); b != nil {
				Bcands = append(Bcands, Bcand{"B from PARAM standard address", b})
			}
		}
		if result.Address != "" && isStandard(result.Address) {
			if b := getBFromAddr(result.Address); b != nil {
				Bcands = append(Bcands, Bcand{"B from t.Address standard", b})
			}
		}
		if b := getBFromAddr(address); b != nil {
			Bcands = append(Bcands, Bcand{"B main (fallback)", b})
		}
		if result.SubaddrMajor != 0 || result.SubaddrMinor != 0 {
			if mainP := getBFromAddr(address); mainP != nil {
				if bp, e := computeSubaddressSpendKey(mainP, a, uint64(result.SubaddrMajor), uint64(result.SubaddrMinor)); e == nil {
					Bcands = append(Bcands, Bcand{fmt.Sprintf("B' computed (%d,%d)", result.SubaddrMajor, result.SubaddrMinor), bp})
				} else {
					fmt.Println("warn: computeSubaddressSpendKey:", e)
				}
			}
		}
	} else {
		// Có 0x04 → thường là subaddress; ưu tiên B' từ t.Address hoặc compute
		if result.Address != "" && isSubAddr(result.Address) {
			if b := getBFromAddr(result.Address); b != nil {
				Bcands = append(Bcands, Bcand{"B' from t.Address (subaddress)", b})
			}
		}
		if result.SubaddrMajor != 0 || result.SubaddrMinor != 0 {
			if mainP := getBFromAddr(address); mainP != nil {
				if bp, e := computeSubaddressSpendKey(mainP, a, uint64(result.SubaddrMajor), uint64(result.SubaddrMinor)); e == nil {
					Bcands = append(Bcands, Bcand{fmt.Sprintf("B' computed (%d,%d)", result.SubaddrMajor, result.SubaddrMinor), bp})
				} else {
					fmt.Println("warn: computeSubaddressSpendKey:", e)
				}
			}
		}
		if b := getBFromAddr(address); b != nil {
			Bcands = append(Bcands, Bcand{"B main (fallback)", b})
		}
	}

	// Khử trùng lặp B
	seenB := make(map[string]struct{})
	uniq := make([]Bcand, 0, len(Bcands))
	for _, c := range Bcands {
		if c.B == nil {
			continue
		}
		k := hex.EncodeToString(c.B.Bytes())
		if _, ok := seenB[k]; ok {
			continue
		}
		seenB[k] = struct{}{}
		uniq = append(uniq, c)
	}
	Bcands = uniq
	fmt.Printf("B candidates count = %d\n", len(Bcands))
	if len(Bcands) == 0 {
		fmt.Println("warn: no B candidates; cannot match outputs")
		return result, nil
	}

	// 5) Thử match với từng B; try 3 biến thể derivation (V1/V2/V3) để debug
	var (
		ownedOuts       []ownedOut
		derivVariantHit int // 1,2,3
		bChosenLabel    string
	)
	for _, bc := range Bcands {
		fmt.Println("trying match with", bc.Label)
		outs, usedVariant, errTry := tryMatchWithB(te, outOneTimeKeys, Rcands, bc.B, a, true /*debug per-index*/)
		if errTry != nil {
			fmt.Println("warn: match error:", errTry)
			continue
		}
		if len(outs) > 0 {
			fmt.Println("matched with", bc.Label, " n=", len(outs), " variant=", usedVariant)
			ownedOuts = outs
			derivVariantHit = usedVariant
			bChosenLabel = bc.Label
			break
		}
	}
	if len(ownedOuts) == 0 {
		fmt.Println("warn: owned outputs not found with any B-candidate")
		return result, nil
	}

	fmt.Println("B chosen:", bChosenLabel, "deriv variant:", derivVariantHit)

	// 6) Cập nhật indices
	indices := make([]int, 0, len(ownedOuts))
	for _, o := range ownedOuts {
		indices = append(indices, o.Index)
	}
	result.OwnedOutputIndices = indices
	fmt.Println("Check output array: ", result.OwnedOutputIndices)

	// 7) Giải mã amount từng output đã xác định
	per := make(map[int]uint64, len(ownedOuts))
	var sumDecoded uint64
	for _, o := range ownedOuts {
		i := o.Index
		if i >= len(ecdhAmtC) || i >= len(ecdhMaskC) {
			fmt.Println("warn: missing ecdhInfo for vout[", i)
			continue
		}
		// CẢNH BÁO nếu variant match ≠ 1 mà hàm decode của bạn đang dùng V1
		if derivVariantHit != 1 {
			fmt.Println("warn: match used derivation variant", derivVariantHit, "but ringCTDecodeAmountForIndex likely uses V1; consider aligning it.")
		}
		amt, derr := ringCTDecodeAmountForIndex(a, o.RUsed, i, ecdhAmtC[i], ecdhMaskC[i])
		if derr != nil {
			fmt.Println("warn: decode amount vout[:", i, "]. err: ", derr)
			continue
		}
		per[i] = amt
		sumDecoded += amt
	}
	if len(per) > 0 {
		result.PerOutputAmounts = per
		// result.Amount = sumDecoded // nếu muốn đồng bộ tổng
	}
	fmt.Println("Check output amount lenght:  ", len(result.PerOutputAmounts))
	for key, value := range result.PerOutputAmounts {
		fmt.Println("Check amoutn output map: Key: ", key, ". Value: ", value)
	}
	if result.Amount > 0 && sumDecoded > 0 {
		if result.Amount != sumDecoded {
			fmt.Printf("WARNING: RPC amount (%d) != decoded sum (%d)\n", result.Amount, sumDecoded)
		} else {
			fmt.Println("OK: RPC amount matches decoded sum")
		}
	}
	return result, nil
}

func computeSubaddressSpendKey(B *edwards25519.Point, a *edwards25519.Scalar, major, minor uint64) (*edwards25519.Point, error) {
	// tag = "SubAddr\000"
	tag := []byte{'S', 'u', 'b', 'A', 'd', 'd', 'r', 0x00}
	// aBytes: 32B little-endian of a
	aBytes := a.Bytes()
	payload := make([]byte, 0, len(tag)+32+10+10)
	payload = append(payload, tag...)
	payload = append(payload, aBytes...)
	payload = append(payload, moneroVarint(major)...)
	payload = append(payload, moneroVarint(minor)...)

	// k = Hs(payload)
	k := hashToScalarHs(payload)

	// B' = B + k*G
	kG := new(edwards25519.Point).ScalarBaseMult(k)
	Bprime := new(edwards25519.Point).Add(B, kG)
	return Bprime, nil
}

func keccak256(parts ...[]byte) []byte {
	h := sha3.NewLegacyKeccak256()
	for _, p := range parts {
		_, _ = h.Write(p)
	}
	return h.Sum(nil)
}

// chuyển 32-byte little-endian -> big.Int (big-endian internal)
func le32ToBigInt(le []byte) *big.Int {
	// le length must be 32
	if len(le) != 32 {
		// pad/truncate an toàn nếu cần
		buf := make([]byte, 32)
		copy(buf, le)
		le = buf
	}
	// đảo thành big-endian để SetBytes hiểu
	be := make([]byte, 32)
	for i := 0; i < 32; i++ {
		be[i] = le[31-i]
	}
	return new(big.Int).SetBytes(be)
}

// ghi big.Int (0 <= x < ℓ) thành 32-byte little-endian
func bigIntToLE32(x *big.Int) []byte {
	be := x.Bytes() // big-endian
	le := make([]byte, 32)
	// copy ngược sang LE, phần còn lại zero-pad
	for i := 0; i < len(be) && i < 32; i++ {
		le[i] = be[len(be)-1-i]
	}
	return le
}

func hashToScalarHs(data []byte) *edwards25519.Scalar {
	// 1) Keccak-256
	h := sha3.NewLegacyKeccak256()
	_, _ = h.Write(data)
	sum := h.Sum(nil) // 32 bytes (Monero coi đây là LE input cho sc_reduce32)

	// 2) interpret sum như 256-bit little-endian, reduce mod ℓ
	n := le32ToBigInt(sum)
	n.Mod(n, ed25519Order)

	// 3) encode về 32B little-endian canonical
	canonLE := bigIntToLE32(n)

	// 4) set scalar
	s := edwards25519.NewScalar()
	if _, err := s.SetCanonicalBytes(canonLE); err != nil {
		// cực kỳ hiếm khi xảy ra vì đã mod < ℓ; trả scalar 0 cho an toàn
		// (hoặc đổi sang panic nếu bạn muốn fail fast trong dev)
		return new(edwards25519.Scalar)
	}
	return s
}

func bytesToPoint(b []byte) (*edwards25519.Point, error) {
	if len(b) != 32 {
		return nil, errors.New("point len != 32")
	}
	P := new(edwards25519.Point)
	if _, err := P.SetBytes(b); err != nil {
		return nil, err
	}
	return P, nil
}

func ringCTDecodeAmountForIndex(
	a *edwards25519.Scalar,
	R *edwards25519.Point,
	outputIndex int,
	amountCipher, maskCipher string,
) (uint64, error) {

	// Derive shared secret: r = Hs(a * R)
	var shared edwards25519.Point
	shared.ScalarMult(a, R)
	secret := keccak256(shared.Bytes())

	amtB, _ := hex.DecodeString(amountCipher)
	maskB, _ := hex.DecodeString(maskCipher)

	if len(amtB) != 8 || len(maskB) != 32 {
		return 0, fmt.Errorf("invalid ecdhInfo size")
	}

	var mask [32]byte
	copy(mask[:], maskB)
	var encryptedAmt [8]byte
	copy(encryptedAmt[:], amtB)

	// XOR mask
	var derivedMask [32]byte
	for i := 0; i < 32; i++ {
		derivedMask[i] = mask[i] ^ secret[i]
	}

	// Derive amount mask (first 8 bytes of derivedMask)
	var amountMask [8]byte
	copy(amountMask[:], derivedMask[:8])

	// Decrypt amount
	var amount uint64
	for i := 0; i < 8; i++ {
		amount |= uint64(encryptedAmt[i]^amountMask[i]) << (8 * i)
	}

	return amount, nil
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
	return fmt.Sprintf("watch_%s_%s", shortAddr, shortHash)
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

func ParseTxExtra(hexExtra string) (*XmrTxExtra, error) {
	b, err := hex.DecodeString(hexExtra)
	if err != nil {
		return nil, err
	}

	te := &XmrTxExtra{
		RawHex:        hexExtra,
		UnknownFields: make(map[byte][]byte),
	}

	// LEB128 varint reader
	readVarint := func(i *int) (int, error) {
		n := len(b)
		val, shift := 0, 0
		for {
			if *i >= n {
				return 0, errors.New("varint truncated")
			}
			c := int(b[*i])
			*i++
			val |= (c & 0x7F) << shift
			if (c & 0x80) == 0 {
				break
			}
			shift += 7
			if shift > 10*7 {
				return 0, errors.New("varint too long")
			}
		}
		return val, nil
	}

	i := 0
	n := len(b)
	for i < n {
		tag := b[i]
		i++

		switch tag {
		case 0x00: // padding
			// no-op

		case 0x01: // tx pubkey (32B)
			if i+32 > n {
				return nil, errors.New("tx extra: pubkey truncated")
			}
			te.TxPublicKey = hex.EncodeToString(b[i : i+32])
			i += 32

		case 0x02: // extra nonce: [varint LEN][LEN BYTES]  <-- SỬA: dùng varint, không phải 1 byte!
			L, err := readVarint(&i)
			if err != nil {
				return nil, fmt.Errorf("tx extra: nonce varint: %w", err)
			}
			if i+L > n {
				return nil, errors.New("tx extra: nonce truncated")
			}
			nonce := b[i : i+L]
			te.ExtraNonce = append([]byte(nil), nonce...)
			// parse inner nonce tags (first byte)
			if L > 0 {
				switch nonce[0] {
				case 0x00: // long payment id (32B)
					if len(nonce) >= 1+32 {
						te.PaymentID = hex.EncodeToString(nonce[1 : 1+32])
					}
				case 0x01: // encrypted short payment id (8B)
					if len(nonce) >= 1+8 {
						te.EncryptedPaymentID = hex.EncodeToString(nonce[1 : 1+8])
					}
				default:
					te.UnknownFields[0x02] = append([]byte(nil), nonce...)
				}
			}
			i += L

		case 0x03: // merge-mining: [varint LEN][LEN BYTES] (phải skip đúng LEN)
			L, err := readVarint(&i)
			if err != nil {
				return nil, fmt.Errorf("tx extra: mm varint: %w", err)
			}
			if i+L > n {
				return nil, fmt.Errorf("tx extra: mm truncated need %d", L)
			}
			te.UnknownFields[0x03] = append([]byte(nil), b[i:i+L]...)
			i += L

		case 0x04: // additional pubkeys: [varint LEN][LEN bytes = N*32]
			L, err := readVarint(&i)
			if err != nil {
				return nil, fmt.Errorf("tx extra: addl varint: %w", err)
			}
			if L == 0 || (L%32) != 0 {
				return nil, fmt.Errorf("tx extra: additional pubkeys length %d not multiple of 32", L)
			}
			if i+L > n {
				return nil, fmt.Errorf("tx extra: addl truncated need %d", L)
			}
			cnt := L / 32
			arr := make([]string, 0, cnt)
			for k := 0; k < cnt; k++ {
				arr = append(arr, hex.EncodeToString(b[i:i+32]))
				i += 32
			}
			te.AdditionalPubkeys = arr

		default:
			// Best-effort TLV: [tag][varint LEN][LEN BYTES]
			L, err := readVarint(&i)
			if err != nil {
				return nil, fmt.Errorf("tx extra: unknown tag 0x%02x varint err: %w", tag, err)
			}
			if i+L > n {
				return nil, fmt.Errorf("tx extra: unknown tag 0x%02x truncated need %d", tag, L)
			}
			te.UnknownFields[tag] = append([]byte(nil), b[i:i+L]...)
			i += L
		}
	}
	return te, nil
}

func DecodeOutputs2(
	address, viewKey, txid, txJSONStr string,
) (*DecodedTx, error) {

	if address == "" || viewKey == "" || txid == "" {
		return nil, errors.New("address, viewKey, txid required")
	}

	// === 1. Parse view key ===
	vk, err := hex.DecodeString(viewKey)
	if err != nil || len(vk) != 32 {
		return nil, errors.New("invalid viewKey")
	}
	var a edwards25519.Scalar
	if _, err := a.SetCanonicalBytes(vk); err != nil {
		return nil, errors.New("viewKey not canonical")
	}

	// === 2. Parse tx JSON (chỉ lấy extra, vout.key, ecdhInfo) ===
	extraHex, voutKeys, ecdhAmt, ecdhMask, err := parseRingCTTx(txJSONStr)
	if err != nil {
		return nil, fmt.Errorf("parse tx: %w", err)
	}
	if len(voutKeys) == 0 {
		return nil, errors.New("no vout")
	}
	if len(ecdhAmt) != len(voutKeys) || len(ecdhMask) != len(voutKeys) {
		return nil, errors.New("ecdhInfo length mismatch")
	}

	// === 3. Parse tx_extra ===
	te, err := ParseTxExtra(extraHex)
	if err != nil {
		return nil, fmt.Errorf("parse extra: %w", err)
	}

	// === 4. Build R candidates (tx_pub + additional_pubkeys) ===
	Rcands := buildRcands(te)
	if len(Rcands) == 0 {
		return nil, errors.New("no R public key")
	}

	// === 5. Build B candidates (standard + subaddress) ===
	Bcands := buildBcands(address, te)
	if len(Bcands) == 0 {
		return nil, errors.New("no B candidate")
	}

	// === 6. Match outputs using view key + derivation ===
	var owned []ownedOut
	var variant int
	var bLabel string

	for _, bc := range Bcands {
		outs, v, err := tryMatchWithB2(voutKeys, Rcands, bc.B, &a)
		if err != nil || len(outs) == 0 {
			continue
		}
		owned = outs
		variant = v
		bLabel = bc.Label
		break
	}

	if len(owned) == 0 {
		return &DecodedTx{Txid: txid}, nil // không có output nào thuộc về bạn
	}

	// === 7. Decode amount cho từng output ===
	per := make(map[int]uint64)
	var total uint64
	for _, o := range owned {
		i := o.Index
		amt, err := ringCTDecodeAmount(&a, o.RUsed, ecdhAmt[i], ecdhMask[i])
		if err != nil {
			continue
		}
		per[i] = amt
		total += amt
	}

	// === 8. Kết quả ===
	result := &DecodedTx{
		Txid:               txid,
		Amount:             total,
		OwnedOutputIndices: make([]int, len(owned)),
		PerOutputAmounts:   per,
	}
	for i, o := range owned {
		result.OwnedOutputIndices[i] = o.Index
	}

	fmt.Printf("[DECODED] tx=%s, outputs=%v, total=%d piconero, variant=%d, B=%s\n",
		txid[:8], result.OwnedOutputIndices, total, variant, bLabel)
	return result, nil
}

func parseRingCTTx(jsonStr string) (extraHex string, voutKeys, ecdhAmt, ecdhMask []string, err error) {
	var tx struct {
		Extra string `json:"extra"`
		Vout  []struct {
			Target struct {
				Key string `json:"key"`
			} `json:"target"`
		} `json:"vout"`
		RctSignatures struct {
			EcdhInfo []struct {
				Amount string `json:"amount"`
				Mask   string `json:"mask"`
			} `json:"ecdhInfo"`
		} `json:"rct_signatures"`
	}

	if err := json.Unmarshal([]byte(jsonStr), &tx); err != nil {
		return "", nil, nil, nil, err
	}

	extraHex = tx.Extra
	for _, v := range tx.Vout {
		voutKeys = append(voutKeys, v.Target.Key)
	}
	for _, e := range tx.RctSignatures.EcdhInfo {
		ecdhAmt = append(ecdhAmt, e.Amount)
		ecdhMask = append(ecdhMask, e.Mask)
	}

	return extraHex, voutKeys, ecdhAmt, ecdhMask, nil
}

func buildRcands(te *XmrTxExtra) []*edwards25519.Point {
	var cands []*edwards25519.Point
	if te.TxPublicKey != "" {
		if p := hexToPoint(te.TxPublicKey); p != nil {
			cands = append(cands, p)
		}
	}
	for _, k := range te.AdditionalPubkeys {
		if p := hexToPoint(k); p != nil {
			cands = append(cands, p)
		}
	}
	return cands
}

// buildBcands: ưu tiên subaddress → standard
func buildBcands(addr string, te *XmrTxExtra) []struct {
	Label string
	B     *edwards25519.Point
} {
	var cands []struct {
		Label string
		B     *edwards25519.Point
	}

	// 1. Subaddress: nếu có additional_pubkeys
	if len(te.AdditionalPubkeys) > 0 {
		if ap, err := ParseAddress(addr); err == nil {
			if p, err := bytesToPoint(ap.PublicSpendKey); err == nil {
				cands = append(cands, struct {
					Label string
					B     *edwards25519.Point
				}{"subaddress", p})
			}
		}
	}

	// 2. Standard address
	if ap, err := ParseAddress(addr); err == nil {
		if p, terr := bytesToPoint(ap.PublicSpendKey); terr == nil {
			cands = append(cands, struct {
				Label string
				B     *edwards25519.Point
			}{"standard", p})
		}
	}

	return cands
}

// tryMatchWithB: chỉ dùng V1 và V2 (V3 hiếm)
func tryMatchWithB2(voutKeys []string, Rcands []*edwards25519.Point, B *edwards25519.Point, a *edwards25519.Scalar) ([]ownedOut, int, error) {
	for variant := 1; variant <= 2; variant++ {
		var owned []ownedOut
		for i, key := range voutKeys {
			P := hexToPoint(key)
			if P == nil {
				continue
			}

			for _, R := range Rcands {
				var derived *edwards25519.Point
				if variant == 1 {
					derived = deriveOneTimeKeyV1(R, B, a, uint64(i))
				} else {
					derived = deriveOneTimeKeyV2(R, B, a, uint64(i))
				}
				if derived != nil && derived.Equal(P) == 1 {
					owned = append(owned, ownedOut{Index: i, RUsed: R})
					break
				}
			}
		}
		if len(owned) > 0 {
			return owned, variant, nil
		}
	}
	return nil, 0, errors.New("no match")
}

// ringCTDecodeAmount: dùng shared secret = Hs(a*R)
func ringCTDecodeAmount(a *edwards25519.Scalar, R *edwards25519.Point, amtHex, maskHex string) (uint64, error) {
	amtB, _ := hex.DecodeString(amtHex)
	maskB, _ := hex.DecodeString(maskHex)
	if len(amtB) != 8 || len(maskB) != 32 {
		return 0, errors.New("invalid ecdh")
	}

	// shared = Hs(a*R)
	var shared edwards25519.Point
	shared.ScalarMult(a, R)
	secret := keccak256(shared.Bytes())

	// XOR mask
	var derivedMask [32]byte
	for i := 0; i < 32; i++ {
		derivedMask[i] = maskB[i] ^ secret[i]
	}

	// amount = amt XOR derivedMask[:8]
	var amount uint64
	for i := 0; i < 8; i++ {
		amount |= uint64(amtB[i]^derivedMask[i]) << (8 * i)
	}
	return amount, nil
}

func hexToPoint(h string) *edwards25519.Point {
	b, _ := hex.DecodeString(h)
	if len(b) != 32 {
		return nil
	}
	var p edwards25519.Point
	_, err := p.SetBytes(b)
	if err != nil {
		return nil
	}
	return &p
}
