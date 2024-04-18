package dbtypes

import (
	"encoding/hex"
	"fmt"
	"time"

	"github.com/decred/dcrdata/v8/ltcrpcutils"
	"github.com/ltcsuite/ltcd/chaincfg"
	ltcClient "github.com/ltcsuite/ltcd/rpcclient"
	"github.com/ltcsuite/ltcd/txscript"
	"github.com/ltcsuite/ltcd/wire"
)

// AddressRow represents a row in the addresses table
type MutilchainAddressRow struct {
	// id int64
	Address            string
	FundingTxDbID      uint64
	FundingTxHash      string
	FundingTxVoutIndex uint32
	VoutDbID           uint64
	Value              uint64
	SpendingTxDbID     uint64
	SpendingTxHash     string
	SpendingTxVinIndex uint32
	VinDbID            uint64
}

// MsgBlockToDBBlock creates a dbtypes.Block from a wire.MsgBlock
func MsgLTCBlockToDBBlock(client *ltcClient.Client, msgBlock *wire.MsgBlock, chainParams *chaincfg.Params) *Block {
	// Create the dbtypes.Block structure
	blockHeader := msgBlock.Header
	blockHeaderResult := ltcrpcutils.GetBlockHeaderVerboseByString(client, blockHeader.BlockHash().String())
	// convert each transaction hash to a hex string
	var txHashStrs []string
	txHashes, _ := msgBlock.TxHashes()
	for i := range txHashes {
		txHashStrs = append(txHashStrs, txHashes[i].String())
	}
	// Assemble the block
	return &Block{
		Hash:    blockHeader.BlockHash().String(),
		Size:    uint32(msgBlock.SerializeSize()),
		Height:  uint32(blockHeaderResult.Height),
		Version: uint32(blockHeader.Version),
		NumTx:   uint32(len(msgBlock.Transactions)),
		// nil []int64 for TxDbIDs
		NumRegTx:     uint32(len(msgBlock.Transactions)),
		Tx:           txHashStrs,
		Time:         NewTimeDef(time.Unix(blockHeaderResult.Time, 0)),
		Nonce:        uint64(blockHeader.Nonce),
		Bits:         blockHeader.Bits,
		Difficulty:   blockHeaderResult.Difficulty,
		PreviousHash: blockHeader.PrevBlock.String(),
	}
}

func ExtractLTCBlockTransactions(client *ltcClient.Client, block *Block, msgBlock *wire.MsgBlock,
	chainParams *chaincfg.Params) ([]*Tx, [][]*Vout, []VinTxPropertyARRAY) {
	dbTxs, dbTxVouts, dbTxVins := processLTCTransactions(client, block, msgBlock, chainParams)
	return dbTxs, dbTxVouts, dbTxVins
}

func processLTCTransactions(client *ltcClient.Client, block *Block, msgBlock *wire.MsgBlock, chainParams *chaincfg.Params) ([]*Tx, [][]*Vout, []VinTxPropertyARRAY) {
	var txs = msgBlock.Transactions
	blockHash := msgBlock.BlockHash()
	dbTransactions := make([]*Tx, 0, len(txs))
	dbTxVouts := make([][]*Vout, len(txs))
	dbTxVins := make([]VinTxPropertyARRAY, len(txs))

	for txIndex, tx := range txs {
		var sent int64
		for _, txout := range tx.TxOut {
			sent += txout.Value
		}

		dbTx := &Tx{
			BlockHash:   blockHash.String(),
			BlockHeight: int64(block.Height),
			BlockTime:   block.Time,
			Time:        block.Time,
			Version:     uint16(tx.Version),
			TxID:        tx.TxHash().String(),
			BlockIndex:  uint32(txIndex),
			Locktime:    tx.LockTime,
			Size:        uint32(tx.SerializeSize()),
			Sent:        sent,
			NumVin:      uint32(len(tx.TxIn)),
			NumVout:     uint32(len(tx.TxOut)),
		}

		dbTxVins[txIndex] = make(VinTxPropertyARRAY, 0, len(tx.TxIn))
		for idx, txin := range tx.TxIn {
			dbTxVins[txIndex] = append(dbTxVins[txIndex], VinTxProperty{
				PrevOut:     txin.PreviousOutPoint.String(),
				PrevTxHash:  txin.PreviousOutPoint.Hash.String(),
				PrevTxIndex: txin.PreviousOutPoint.Index,
				Sequence:    txin.Sequence,
				TxID:        dbTx.TxID,
				TxIndex:     uint32(idx),
				TxTree:      uint16(dbTx.Tree),
				BlockHeight: block.Height,
				ScriptSig:   txin.SignatureScript,
			})
		}
		// Vouts and their db IDs
		dbTxVouts[txIndex] = make([]*Vout, 0, len(tx.TxOut))
		//dbTx.Vouts = make([]*Vout, 0, len(tx.TxOut))
		for io, txout := range tx.TxOut {
			vout := Vout{
				TxHash:       dbTx.TxID,
				TxIndex:      uint32(io),
				Value:        uint64(txout.Value),
				ScriptPubKey: txout.PkScript,
			}
			scriptClass, scriptAddrs, reqSigs, err := txscript.ExtractPkScriptAddrs(vout.ScriptPubKey, chainParams)
			if err != nil {
				fmt.Println(len(vout.ScriptPubKey), err, hex.EncodeToString(vout.ScriptPubKey))
			}
			addys := make([]string, 0, len(scriptAddrs))
			for ia := range scriptAddrs {
				addys = append(addys, scriptAddrs[ia].String())
			}
			vout.ScriptPubKeyData.ReqSigs = uint32(reqSigs)
			vout.ScriptPubKeyData.Type = ScriptClass(scriptClass)
			vout.ScriptPubKeyData.Addresses = addys
			dbTxVouts[txIndex] = append(dbTxVouts[txIndex], &vout)
			//dbTx.Vouts = append(dbTx.Vouts, &vout)
		}

		//dbTx.VoutDbIds = make([]uint64, len(dbTxVouts[txIndex]))

		dbTransactions = append(dbTransactions, dbTx)
	}

	return dbTransactions, dbTxVouts, dbTxVins
}
