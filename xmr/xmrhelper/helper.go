package xmrhelper

import (
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/decred/dcrdata/v8/db/dbtypes"
	"github.com/decred/dcrdata/v8/xmr/xmrclient"
	"github.com/decred/dcrdata/v8/xmr/xmrutil"
)

func GetXMRBlockSize(bldata *xmrutil.BlockResult) int64 {
	size := 0
	var blobBytes []byte
	if bldata.Blob != "" {
		b, err := hex.DecodeString(bldata.Blob)
		if err == nil {
			blobBytes = b
		}
	}
	if len(blobBytes) > 0 {
		size = len(blobBytes)
	}
	return int64(size)
}

func MsgXMRBlockToDBBlock(client *xmrclient.XMRClient, bldata *xmrutil.BlockResult, height uint64) (*dbtypes.Block, error) {
	allHashes := make([]string, 0, 1+len(bldata.TxHashes))
	if bldata.MinerTxHash != "" {
		allHashes = append(allHashes, bldata.MinerTxHash)
	}
	allHashes = append(allHashes, bldata.TxHashes...)
	// Create the dbtypes.Block structure
	blheader, err := client.GetBlockHeaderByHeight(height)
	if err != nil {
		return nil, err
	}
	version := 0
	if blheader.MajorVersion != 0 {
		version = int(blheader.MajorVersion)
	}
	var diffNum sql.NullString
	var cumDiff sql.NullString
	if blheader.DifficultyNum != "" {
		diffNum = sql.NullString{String: blheader.DifficultyNum, Valid: true}
	}
	if blheader.CumulativeDifficulty != "" {
		cumDiff = sql.NullString{String: blheader.CumulativeDifficulty.String(), Valid: true}
	}
	var difficultyNum interface{} = nil
	var cumulativeDifficulty interface{} = nil
	if diffNum.Valid {
		difficultyNum = diffNum.String
	}
	if cumDiff.Valid {
		cumulativeDifficulty = cumDiff.String
	}
	diff, err := blheader.Difficulty.Float64()
	if err != nil {
		diff = 0
	}
	// Assemble the block
	return &dbtypes.Block{
		Hash:    blheader.Hash,
		Size:    uint32(GetXMRBlockSize(bldata)),
		Height:  uint32(height),
		Version: uint32(version),
		NumTx:   uint32(len(allHashes)),
		// nil []int64 for TxDbIDs
		NumRegTx:             uint32(len(allHashes)),
		Tx:                   allHashes,
		Time:                 dbtypes.NewTimeDef(time.Unix(int64(blheader.Timestamp), 0)),
		Nonce:                blheader.Nonce,
		Bits:                 0,
		Difficulty:           diff,
		DifficultyNum:        difficultyNum,
		CumulativeDifficulty: cumulativeDifficulty,
		PreviousHash:         blheader.PrevHash,
		PowAlgo:              blheader.PowAlgo,
	}, nil
}

// ---------------------- Helpers & small utils ----------------------

func NullIntToInterface(n sql.NullInt64) interface{} {
	if n.Valid {
		return n.Int64
	}
	return nil
}
func NullStringToInterface(s sql.NullString) interface{} {
	if s.Valid {
		return s.String
	}
	return nil
}
func NullInt64ToInterface(v int64) interface{} {
	if v < 0 {
		return nil
	}
	return v
}
func NullIntToInterfaceInt(v int) interface{} {
	if v < 0 {
		return nil
	}
	return v
}

func ParseInt64FromString(s string) (int64, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, errors.New("empty")
	}
	var res int64
	_, err := fmt.Sscan(s, &res)
	return res, err
}
func ParseUint64FromString(s string) (uint64, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, errors.New("empty")
	}
	var res uint64
	_, err := fmt.Sscan(s, &res)
	return res, err
}

// offsetsToGlobalIndices converts Monero key_offsets (relative) to cumulative global indices.
func OffsetsToGlobalIndices(offsets []uint64) []uint64 {
	out := make([]uint64, len(offsets))
	var acc uint64
	for i, o := range offsets {
		acc += o
		out[i] = acc
	}
	return out
}

// parse hex string possibly empty to bytes
func HexToBytesSafe(s string) []byte {
	if s == "" {
		return nil
	}
	b, err := hex.DecodeString(s)
	if err != nil {
		return nil
	}
	return b
}

// helpers for placeholders
func HdrSafe(txJSON []byte, key string) interface{} { return nil }
func blockHeightToInt(h uint64) int64               { return int64(h) }
func blockTimeToInt64(t uint64) int64               { return int64(t) }
