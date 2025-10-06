package dbtypes

import (
	"encoding/hex"
	"fmt"
	"time"

	"github.com/btcsuite/btcd/btcjson"
	"github.com/btcsuite/btcd/chaincfg"
	btcClient "github.com/btcsuite/btcd/rpcclient"
	"github.com/btcsuite/btcd/txscript"
	"github.com/btcsuite/btcd/wire"
	"github.com/decred/dcrdata/v8/mutilchain"
	"github.com/decred/dcrdata/v8/mutilchain/btcrpcutils"
)

// MsgBlockToDBBlock creates a dbtypes.Block from a wire.MsgBlock
func MsgBTCBlockToDBBlock(client *btcClient.Client, msgBlock *wire.MsgBlock, chainParams *chaincfg.Params) *Block {
	// Create the dbtypes.Block structure
	blockHeader := msgBlock.Header
	blockHeaderResult := btcrpcutils.GetBlockHeaderVerboseByString(client, blockHeader.BlockHash().String())
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

func ExtractBTCBlockTransactions(client *btcClient.Client, block *Block, msgBlock *wire.MsgBlock,
	chainParams *chaincfg.Params) ([]*Tx, [][]*Vout, []VinTxPropertyARRAY) {
	dbTxs, dbTxVouts, dbTxVins := processBTCTransactions(client, block, msgBlock, chainParams)
	return dbTxs, dbTxVouts, dbTxVins
}

func ExtractBTCBlockTransactionsSimpleInfo(client *btcClient.Client, block *Block, msgBlock *wire.MsgBlock,
	chainParams *chaincfg.Params) []*Tx {
	dbTxs := processBTCTransactionsSimpleInfo(client, block, msgBlock, chainParams)
	return dbTxs
}

func GetBTCValueInOfTransaction(client *btcClient.Client, vin *wire.TxIn) int64 {
	prevTransaction, err := btcrpcutils.GetRawTransactionByTxidStr(client, vin.PreviousOutPoint.Hash.String())
	if err != nil {
		return 0
	}
	return GetBTCValueInFromRawTransction(prevTransaction, vin)
}

func GetBTCValueInFromRawTransction(rawTx *btcjson.TxRawResult, vin *wire.TxIn) int64 {
	if rawTx.Vout == nil || len(rawTx.Vout) <= int(vin.PreviousOutPoint.Index) {
		return 0
	}
	return GetMutilchainUnitAmount(rawTx.Vout[vin.PreviousOutPoint.Index].Value, mutilchain.TYPEBTC)
}

func processBTCTransactions(client *btcClient.Client, block *Block, msgBlock *wire.MsgBlock, chainParams *chaincfg.Params) ([]*Tx, [][]*Vout, []VinTxPropertyARRAY) {
	var txs = msgBlock.Transactions
	blockHash := msgBlock.BlockHash()
	dbTransactions := make([]*Tx, 0, len(txs))
	dbTxVouts := make([][]*Vout, len(txs))
	dbTxVins := make([]VinTxPropertyARRAY, len(txs))

	for txIndex, tx := range txs {
		var sent int64
		var spent int64
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
		var isCoinbase = false
		//Get rawtransaction
		txRawResult, rawErr := btcrpcutils.GetRawTransactionByTxidStr(client, tx.TxHash().String())
		if rawErr == nil {
			isCoinbase = len(txRawResult.Vin) > 0 && txRawResult.Vin[0].IsCoinBase()
		}
		dbTxVins[txIndex] = make(VinTxPropertyARRAY, 0, len(tx.TxIn))
		if !isCoinbase {
			for idx, txin := range tx.TxIn {
				unitAmount := int64(0)
				var blockHeight uint32
				var txinTime TimeDef
				//Get transaction by txin
				txInResult, txinErr := btcrpcutils.GetRawTransactionByTxidStr(client, txin.PreviousOutPoint.Hash.String())
				if txinErr == nil {
					txinTime = NewTimeDef(time.Unix(txInResult.Time/1000, 0))
					blockInfo := btcrpcutils.GetBlockVerboseByHash(client, txInResult.BlockHash)
					if blockInfo != nil {
						blockHeight = uint32(blockInfo.Height)
					}
					unitAmount = GetBTCValueInFromRawTransction(txInResult, txin)
					spent += unitAmount
				} else {
					txinTime = dbTx.Time
				}

				dbTxVins[txIndex] = append(dbTxVins[txIndex], VinTxProperty{
					PrevOut:     txin.PreviousOutPoint.String(),
					PrevTxHash:  txin.PreviousOutPoint.Hash.String(),
					PrevTxIndex: txin.PreviousOutPoint.Index,
					Sequence:    txin.Sequence,
					ValueIn:     unitAmount,
					TxID:        dbTx.TxID,
					TxIndex:     uint32(idx),
					TxTree:      uint16(dbTx.Tree),
					Time:        txinTime,
					BlockHeight: blockHeight,
					ScriptSig:   txin.SignatureScript,
				})
			}
		}
		dbTx.Spent = spent
		if !isCoinbase {
			dbTx.Fees = dbTx.Spent - dbTx.Sent
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

func processBTCTransactionsSimpleInfo(client *btcClient.Client, block *Block, msgBlock *wire.MsgBlock, chainParams *chaincfg.Params) []*Tx {
	var txs = msgBlock.Transactions
	blockHash := msgBlock.BlockHash()
	dbTransactions := make([]*Tx, 0, len(txs))

	for txIndex, tx := range txs {
		var sent int64
		var spent int64
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
		var isCoinbase = false
		//Get rawtransaction
		txRawResult, rawErr := btcrpcutils.GetRawTransactionByTxidStr(client, tx.TxHash().String())
		if rawErr == nil {
			isCoinbase = len(txRawResult.Vin) > 0 && txRawResult.Vin[0].IsCoinBase()
		}
		if !isCoinbase {
			for _, txin := range tx.TxIn {
				unitAmount := int64(0)
				//Get transaction by txin
				txInResult, txinErr := btcrpcutils.GetRawTransactionByTxidStr(client, txin.PreviousOutPoint.Hash.String())
				if txinErr == nil {
					unitAmount = GetBTCValueInFromRawTransction(txInResult, txin)
					spent += unitAmount
				}
			}
		}
		dbTx.Spent = spent
		if !isCoinbase {
			dbTx.Fees = dbTx.Spent - dbTx.Sent
		}
		dbTransactions = append(dbTransactions, dbTx)
	}
	return dbTransactions
}
