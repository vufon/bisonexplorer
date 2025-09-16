package dcrpg

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"time"

	"github.com/decred/dcrdata/db/dcrpg/v8/internal/mutilchainquery"
	"github.com/decred/dcrdata/v8/db/dbtypes"
	"github.com/decred/dcrdata/v8/mutilchain"
	"github.com/decred/dcrdata/v8/xmr/xmrhelper"
	"github.com/lib/pq"
)

func RetrieveMutilchainBestBlockHeight(db *sql.DB, chainType string) (height uint64, hash string, id uint64, err error) {
	err = db.QueryRow(mutilchainquery.RetrieveBestBlockAllHeightStatement(chainType)).Scan(&id, &hash, &height)
	return
}

func InsertMutilchainVouts(db *sql.DB, dbVouts []*dbtypes.Vout, checked bool, chainType string) ([]uint64, []dbtypes.MutilchainAddressRow, error) {
	addressRows := make([]dbtypes.MutilchainAddressRow, 0, len(dbVouts)*2)
	dbtx, err := db.Begin()
	if err != nil {
		return nil, nil, fmt.Errorf("unable to begin database transaction: %v", err)
	}
	stmt, err := dbtx.Prepare(mutilchainquery.MakeVoutInsertStatement(checked, chainType))
	if err != nil {
		log.Errorf("%s Vout INSERT prepare: %v", chainType, err)
		_ = dbtx.Rollback() // try, but we want the Prepare error back
		return nil, nil, err
	}

	ids := make([]uint64, 0, len(dbVouts))
	for _, vout := range dbVouts {
		var id uint64
		err := stmt.QueryRow(
			vout.TxHash, vout.TxIndex, vout.TxTree, vout.Value, vout.Version,
			vout.ScriptPubKey, vout.ScriptPubKeyData.ReqSigs,
			vout.ScriptPubKeyData.Type,
			pq.Array(vout.ScriptPubKeyData.Addresses)).Scan(&id)
		if err != nil {
			if err == sql.ErrNoRows {
				continue
			}
			_ = stmt.Close() // try, but we want the QueryRow error back
			if errRoll := dbtx.Rollback(); errRoll != nil {
				log.Errorf("Rollback failed: %v", errRoll)
			}
			return nil, nil, err
		}
		for _, addr := range vout.ScriptPubKeyData.Addresses {
			addressRows = append(addressRows, dbtypes.MutilchainAddressRow{
				Address:            addr,
				FundingTxHash:      vout.TxHash,
				FundingTxVoutIndex: vout.TxIndex,
				VoutDbID:           id,
				Value:              vout.Value,
			})
		}
		ids = append(ids, id)
	}

	// Close prepared statement. Ignore errors as we'll Commit regardless.
	_ = stmt.Close()

	return ids, addressRows, dbtx.Commit()
}

func InsertMutilchainWholeVouts(db *sql.DB, dbVouts []*dbtypes.Vout, checked bool, chainType string) ([]uint64, []dbtypes.MutilchainAddressRow, error) {
	addressRows := make([]dbtypes.MutilchainAddressRow, 0, len(dbVouts)*2)
	dbtx, err := db.Begin()
	if err != nil {
		return nil, nil, fmt.Errorf("%s: unable to begin database transaction: %v", chainType, err)
	}
	stmt, err := dbtx.Prepare(mutilchainquery.MakeVoutAllInsertStatement(checked, chainType))
	if err != nil {
		log.Errorf("%s: Vout INSERT prepare: %v", chainType, err)
		_ = dbtx.Rollback() // try, but we want the Prepare error back
		return nil, nil, err
	}

	ids := make([]uint64, 0, len(dbVouts))
	for _, vout := range dbVouts {
		var id uint64
		err := stmt.QueryRow(
			vout.TxHash, vout.TxIndex, vout.TxTree, vout.Value, vout.Version,
			vout.ScriptPubKey, vout.ScriptPubKeyData.ReqSigs,
			vout.ScriptPubKeyData.Type,
			pq.Array(vout.ScriptPubKeyData.Addresses)).Scan(&id)
		if err != nil {
			if err == sql.ErrNoRows {
				continue
			}
			_ = stmt.Close() // try, but we want the QueryRow error back
			if errRoll := dbtx.Rollback(); errRoll != nil {
				log.Errorf("Rollback failed: %v", errRoll)
			}
			return nil, nil, err
		}
		for _, addr := range vout.ScriptPubKeyData.Addresses {
			addressRows = append(addressRows, dbtypes.MutilchainAddressRow{
				Address:            addr,
				FundingTxHash:      vout.TxHash,
				FundingTxVoutIndex: vout.TxIndex,
				VoutDbID:           id,
				Value:              vout.Value,
			})
		}
		ids = append(ids, id)
	}

	// Close prepared statement. Ignore errors as we'll Commit regardless.
	_ = stmt.Close()

	return ids, addressRows, dbtx.Commit()
}

func InsertMutilchainVins(db *sql.DB, dbVins dbtypes.VinTxPropertyARRAY, chainType string, checked bool) ([]uint64, error) {
	dbtx, err := db.Begin()
	if err != nil {
		return nil, fmt.Errorf("unable to begin database transaction: %v", err)
	}
	queryBuilder := mutilchainquery.InsertVinRowFuncCheck(checked, chainType)
	stmt, err := dbtx.Prepare(queryBuilder)
	if err != nil {
		log.Errorf("Vin INSERT prepare: %v", err)
		_ = dbtx.Rollback() // try, but we want the Prepare error back
		return nil, err
	}

	// TODO/Question: Should we skip inserting coinbase txns, which have same PrevTxHash?

	ids := make([]uint64, 0, len(dbVins))
	for _, vin := range dbVins {
		var id uint64
		err = stmt.QueryRow(vin.TxID, vin.TxIndex, vin.TxTree,
			vin.PrevTxHash, vin.PrevTxIndex, vin.PrevTxTree, vin.ValueIn).Scan(&id)
		if err != nil {
			_ = stmt.Close() // try, but we want the QueryRow error back
			if errRoll := dbtx.Rollback(); errRoll != nil {
				log.Errorf("Rollback failed: %v", errRoll)
			}
			return ids, fmt.Errorf("InsertVins INSERT exec failed: %v", err)
		}
		ids = append(ids, id)
	}

	// Close prepared statement. Ignore errors as we'll Commit regardless.
	_ = stmt.Close()

	return ids, dbtx.Commit()
}

func InsertMutilchainWholeVins(db *sql.DB, dbVins dbtypes.VinTxPropertyARRAY, chainType string, checked bool) ([]uint64, error) {
	dbtx, err := db.Begin()
	if err != nil {
		return nil, fmt.Errorf("unable to begin database transaction: %v", err)
	}
	queryBuilder := mutilchainquery.InsertVinAllRowFuncCheck(checked, chainType)
	stmt, err := dbtx.Prepare(queryBuilder)
	if err != nil {
		log.Errorf("%s: Vin INSERT prepare: %v", chainType, err)
		_ = dbtx.Rollback() // try, but we want the Prepare error back
		return nil, err
	}

	// TODO/Question: Should we skip inserting coinbase txns, which have same PrevTxHash?

	ids := make([]uint64, 0, len(dbVins))
	for _, vin := range dbVins {
		var id uint64
		err = stmt.QueryRow(vin.TxID, vin.TxIndex, vin.TxTree,
			vin.PrevTxHash, vin.PrevTxIndex, vin.PrevTxTree, vin.ValueIn).Scan(&id)
		if err != nil {
			_ = stmt.Close() // try, but we want the QueryRow error back
			if errRoll := dbtx.Rollback(); errRoll != nil {
				log.Errorf("Rollback failed: %v", errRoll)
			}
			return ids, fmt.Errorf("%s: InsertVins INSERT exec failed: %v", chainType, err)
		}
		ids = append(ids, id)
	}

	// Close prepared statement. Ignore errors as we'll Commit regardless.
	_ = stmt.Close()

	return ids, dbtx.Commit()
}

func InsertMutilchainTxns(db *sql.DB, dbTxns []*dbtypes.Tx, checked bool, chainType string) ([]uint64, error) {
	dbtx, err := db.Begin()
	if err != nil {
		return nil, fmt.Errorf("unable to begin database transaction: %v", err)
	}

	stmt, err := dbtx.Prepare(mutilchainquery.MakeTxInsertStatement(checked, chainType))
	if err != nil {
		log.Errorf("%s: Txns INSERT prepare: %v", chainType, err)
		_ = dbtx.Rollback() // try, but we want the Prepare error back
		return nil, err
	}

	ids := make([]uint64, 0, len(dbTxns))
	for _, tx := range dbTxns {
		var id uint64
		//TODO: uncomment lock_time
		err := stmt.QueryRow(
			tx.BlockHash, tx.BlockHeight, tx.BlockTime.UNIX(), tx.Time.UNIX(),
			tx.TxType, tx.Version, tx.Tree, tx.TxID, tx.BlockIndex,
			0, tx.Expiry, tx.Size, tx.Spent, tx.Sent, tx.Fees,
			tx.NumVin, "", dbtypes.UInt64Array(tx.VinDbIds),
			tx.NumVout, pq.Array(tx.Vouts), dbtypes.UInt64Array(tx.VoutDbIds)).Scan(&id)
		if err != nil {
			if err == sql.ErrNoRows {
				log.Errorf("%s: Insert to transactions table unsuccessfully. Height: %d", chainType, tx.BlockHeight)
				continue
			}
			_ = stmt.Close() // try, but we want the QueryRow error back
			if errRoll := dbtx.Rollback(); errRoll != nil {
				log.Errorf("Rollback failed: %v", errRoll)
			}
			return nil, err
		}
		ids = append(ids, id)
	}

	// Close prepared statement. Ignore errors as we'll Commit regardless.
	_ = stmt.Close()

	return ids, dbtx.Commit()
}

func ParseAndStoreTxJSON(dbtx *sql.Tx, txHash string, blockHeight uint64, txJSONStr string, checked bool) (int64, int64, int64, error) {
	// parse into map
	var txMap map[string]interface{}
	if err := json.Unmarshal([]byte(txJSONStr), &txMap); err != nil {
		return 0, 0, 0, fmt.Errorf("unmarshal tx json: %v", err)
	}
	voutstmt, err := dbtx.Prepare(mutilchainquery.MakeInsertMoneroVoutsAllRowQuery(checked))
	if err != nil {
		log.Errorf("%s: monero_outputs INSERT prepare: %v", mutilchain.TYPEXMR, err)
		return 0, 0, 0, err
	}

	// voutAddrStmt, err := dbtx.Prepare(mutilchainquery.MakeInsertXmrAddressRowQuery(checked))
	// if err != nil {
	// 	voutstmt.Close()
	// 	log.Errorf("%s: xmraddresses INSERT initialization prepare: %v", mutilchain.TYPEXMR, err)
	// 	return 0, 0, 0, err
	// }

	ringMemberStmt, err := dbtx.Prepare(mutilchainquery.MakeInsertMoneroRingMemberQuery(checked))
	if err != nil {
		voutstmt.Close()
		// voutAddrStmt.Close()
		log.Errorf("%s: monero_ring_members INSERT prepare: %v", mutilchain.TYPEXMR, err)
		return 0, 0, 0, err
	}

	keyImgStmt, err := dbtx.Prepare(mutilchainquery.MakeInsertMoneroKeyImagesQuery(checked))
	if err != nil {
		voutstmt.Close()
		// voutAddrStmt.Close()
		ringMemberStmt.Close()
		log.Errorf("%s: monero_key_images INSERT prepare: %v", mutilchain.TYPEXMR, err)
		return 0, 0, 0, err
	}

	// vinstmt, err := dbtx.Prepare(mutilchainquery.InsertVinAllRowFuncCheck(checked, mutilchain.TYPEXMR))
	// if err != nil {
	// 	voutstmt.Close()
	// 	// voutAddrStmt.Close()
	// 	ringMemberStmt.Close()
	// 	keyImgStmt.Close()
	// 	log.Errorf("%s: xmrvin_all INSERT prepare: %v", mutilchain.TYPEXMR, err)
	// 	return 0, 0, 0, err
	// }

	rctDataStmt, err := dbtx.Prepare(mutilchainquery.MakeInsertMoneroRctDataQuery(checked))
	if err != nil {
		voutstmt.Close()
		// voutAddrStmt.Close()
		ringMemberStmt.Close()
		keyImgStmt.Close()
		// vinstmt.Close()
		log.Errorf("%s: monero_rct_data INSERT prepare: %v", mutilchain.TYPEXMR, err)
		return 0, 0, 0, err
	}

	defer func() {
		voutstmt.Close()
		// voutAddrStmt.Close()
		ringMemberStmt.Close()
		keyImgStmt.Close()
		// vinstmt.Close()
		rctDataStmt.Close()
	}()

	var numVins, numVouts, totalSent int64
	// 1) vout parsing -> monero_outputs
	if voutIf, ok := txMap["vout"].([]interface{}); ok {
		numVouts += int64(len(voutIf))
		for idx, vo := range voutIf {
			if voMap, ok := vo.(map[string]interface{}); ok {
				// target may be under "target" -> "key"
				outPk := ""
				globalIndex := int64(-1)
				amount := int64(0)
				amountKnown := false
				if target, ok2 := voMap["target"].(map[string]interface{}); ok2 {
					if k, ok3 := target["key"].(string); ok3 {
						outPk = k
					}
					// some monero versions include "global_index" in vout
					if gi, ok4 := voMap["global_index"]; ok4 {
						switch v := gi.(type) {
						case float64:
							globalIndex = int64(v)
						case string:
							// sometimes it's string
							if parsed, err := xmrhelper.ParseInt64FromString(v); err == nil {
								globalIndex = parsed
							}
						}
					}
				}
				// amount may be present (non-ringct)
				if amt, ok := voMap["amount"]; ok {
					switch v := amt.(type) {
					case float64:
						amount = int64(v)
						amountKnown = true
					case string:
						if parsed, err := xmrhelper.ParseInt64FromString(v); err == nil {
							amount = parsed
							amountKnown = true
						}
					}
				}
				totalSent += amount
				var mvoutid uint64
				err := voutstmt.QueryRow(txHash, idx, xmrhelper.NullInt64ToInterface(globalIndex), outPk, nil, amountKnown, xmrhelper.NullInt64ToInterface(amount)).Scan(&mvoutid)
				// insert into monero_outputs
				if err != nil {
					return 0, 0, 0, fmt.Errorf("XMR: insertMoneroOutput failed: %v", err)
				}
				// txPubKey := ""
				// // Prepare parameter values: convert sentinels to nil
				// var gv interface{}
				// if globalIndex >= 0 {
				// 	gv = globalIndex
				// } else {
				// 	gv = nil
				// }
				// var voutIDVal interface{}
				// if mvoutid > 0 {
				// 	voutIDVal = mvoutid
				// } else {
				// 	voutIDVal = nil
				// }
				// var outPkVal interface{}
				// if outPk != "" {
				// 	outPkVal = outPk
				// } else {
				// 	outPkVal = nil
				// }
				// var amountVal interface{}
				// if amountKnown {
				// 	amountVal = amount
				// } else {
				// 	amountVal = nil
				// }
				// var firstSeenVal interface{}
				// if blockHeight > 0 {
				// 	firstSeenVal = blockHeight
				// } else {
				// 	firstSeenVal = nil
				// }
				// var txPubKeyVal interface{}
				// if txPubKey != "" {
				// 	txPubKeyVal = txPubKey
				// } else {
				// 	txPubKeyVal = nil
				// }
				// var fundingTxHashVal interface{}
				// if txHash != "" {
				// 	fundingTxHashVal = txHash
				// } else {
				// 	fundingTxHashVal = nil
				// }
				// var fundingVoutIdxVal interface{}
				// if idx >= 0 {
				// 	fundingVoutIdxVal = idx
				// } else {
				// 	fundingVoutIdxVal = nil
				// }
				// var addroutid sql.NullInt64
				// err = voutAddrStmt.QueryRow(outPkVal, gv, amountKnown, amountVal, fundingTxHashVal, fundingVoutIdxVal,
				// 	voutIDVal, txPubKeyVal, firstSeenVal).Scan(&addroutid)
				// insert into xmr addresses row
				// if err != nil {
				// 	return 0, 0, 0, fmt.Errorf("XMR: UpsertAddressForOutput exec failed: %v", err)
				// }
				// if !addroutid.Valid {
				// 	return 0, 0, 0, fmt.Errorf("XMR: UpsertAddressForOutput: no id returned")
				// }
			}
		}
	}

	// 2) vin parsing -> vins_all, key_images, ring members
	if vinIf, ok := txMap["vin"].([]interface{}); ok {
		numVins += int64(len(vinIf))
		for vinIdx, vinItem := range vinIf {
			if vinMap, ok2 := vinItem.(map[string]interface{}); ok2 {
				// --- Key input style (most typical for modern Monero) ---
				if keyObj, ok3 := vinMap["key"].(map[string]interface{}); ok3 {
					// collect offsets (may be absent)
					var offsets []uint64
					if offsIf, ok4 := keyObj["key_offsets"].([]interface{}); ok4 {
						offsets = make([]uint64, 0, len(offsIf))
						for _, oi := range offsIf {
							switch v := oi.(type) {
							case float64:
								offsets = append(offsets, uint64(v))
							case string:
								if parsed, err := xmrhelper.ParseUint64FromString(v); err == nil {
									offsets = append(offsets, parsed)
								}
							}
						}
					}
					// convert to global indices if we have offsets (safe with empty slice)
					globalIdxs := xmrhelper.OffsetsToGlobalIndices(offsets)

					// insert ring members (if any)
					for pos, gi := range globalIdxs {
						var id uint64
						err = ringMemberStmt.QueryRow(txHash, vinIdx, pos, gi).Scan(&id)
						if err != nil {
							return 0, 0, 0, fmt.Errorf("XMR: insertRingMember failed: %v", err)
						}
					}

					// key image k_image (if present)
					if ki, ok5 := keyObj["k_image"].(string); ok5 && ki != "" {
						var id uint64
						err = keyImgStmt.QueryRow(ki, nil, nil, txHash, blockHeight, time.Now().Unix()).Scan(&id)
						if err != nil {
							return 0, 0, 0, fmt.Errorf("XMR: insertKeyImage failed: %v", err)
						}
					}
					// **Insert a vin row for this key-style input**
					// params: tx_hash, tx_index, tx_tree, prev_tx_hash, prev_tx_index, prev_tx_tree, value_in
					// Use nil for prev_tx_hash/prev_tx_index since key-style has no explicit prev out.
					// Use -1 for prev_tx_tree (same as prev-tx branch), 0 for value_in (unknown for ringCT).
					// var mvinid uint64
					// err = vinstmt.QueryRow(txHash, vinIdx, 0, nil, nil, -1, 0).Scan(&mvinid)
					// if err != nil {
					// 	return 0, 0, 0, fmt.Errorf("XMR: insertVinAll(key-style) failed: %v", err)
					// }
				}

				// --- prev_tx stuff (older style) ---
				// if prevHash, ok6 := vinMap["prev_tx_hash"].(string); ok6 {
				// 	// may insert into vins_all with prev fields (best-effort)
				// 	var prevIndex int64 = -1
				// 	if pi, ok7 := vinMap["prev_out_index"]; ok7 {
				// 		switch v := pi.(type) {
				// 		case float64:
				// 			prevIndex = int64(v)
				// 		case string:
				// 			if parsed, err := xmrhelper.ParseInt64FromString(v); err == nil {
				// 				prevIndex = parsed
				// 			}
				// 		}
				// 	}
				// 	// var mvinid uint64
				// 	// err = vinstmt.QueryRow(txHash, vinIdx, 0, prevHash, prevIndex, -1, 0).Scan(&mvinid)
				// 	// if err != nil {
				// 	// 	return 0, 0, 0, fmt.Errorf("XMR: insertVinAll(prev) failed: %v", err)
				// 	// }
				// }
			}
		}
	}

	// 3) rct data
	if rctIf, ok := txMap["rct_signatures"]; ok {
		// store rct blob as raw JSON of rct_signatures or hex if available.
		rctJSON, _ := json.Marshal(rctIf)
		var rctType int = -1
		if rct, ok := txMap["rct_signatures"].(map[string]interface{}); ok {
			if t, ok2 := rct["type"].(float64); ok2 {
				rctType = int(t)
			}
		}
		var rctPrunableHash sql.NullString
		// sometimes prunable hash in txMap under "rct_signatures" or "rct_prunable_hash"
		if rp, ok := txMap["rct_prunable_hash"].(string); ok {
			rctPrunableHash = sql.NullString{String: rp, Valid: true}
		}

		var rctId uint64
		err = rctDataStmt.QueryRow(txHash, rctJSON, xmrhelper.NullStringToInterface(rctPrunableHash), xmrhelper.NullIntToInterfaceInt(rctType)).Scan(&rctId)
		// insert into monero_outputs
		if err != nil {
			return 0, 0, 0, fmt.Errorf("XMR: insertRctData failed: %v", err)
		}
	}
	// done
	return numVins, numVouts, totalSent, nil
}

func InsertXMRTxn(dbtx *sql.Tx, height uint32, hash string, blockTime int64, txHash, txHex, txJSONStr string, checked bool) (uint64, int64, error) {
	stmt, err := dbtx.Prepare(mutilchainquery.MakeTxInsertStatement(checked, mutilchain.TYPEXMR))
	if err != nil {
		log.Errorf("%s: Txns INSERT prepare: %v", mutilchain.TYPEXMR, err)
		return 0, 0, err
	}
	defer stmt.Close()
	var txBlob []byte
	if txHex != "" {
		b, err := hex.DecodeString(txHex)
		if err == nil {
			txBlob = b
		}
	}
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
	timeField := int64(0)
	version := 0
	tree := int16(0)
	blockIndex := 0
	isRingCT := false
	rctType := sql.NullInt64{}
	txPubKey := sql.NullString{}
	prunableSize := sql.NullInt64{}
	lockTime := int64(0)
	expiry := int64(0)
	size := 0
	if txHex != "" {
		size = len(txHex) / 2
	}
	spent := int64(0)
	sent := int64(0)
	fees := int64(0)
	numVin := 0
	vins := []string{}
	numVout := 0

	// parse some common fields from txExtra (tx JSON)
	if txExtra != nil {
		switch v := txExtra.(type) {
		case map[string]interface{}:
			if t, ok := v["version"].(float64); ok {
				version = int(t)
			}
			if tm, ok := v["unlock_time"].(float64); ok {
				timeField = int64(tm)
			}
			if rct, ok := v["rct_signatures"].(map[string]interface{}); ok {
				isRingCT = true
				if rt, ok2 := rct["type"].(float64); ok2 {
					rctType = sql.NullInt64{Int64: int64(rt), Valid: true}
				}
				if feeIf, ok2 := rct["txnFee"].(float64); ok2 {
					fees = int64(feeIf)
				}
			}
			// vins/vouts length
			if vinsIf, ok := v["vin"].([]interface{}); ok {
				numVin = len(vinsIf)
				// store raw vin JSONs as strings for reference
				for _, vi := range vinsIf {
					bs, _ := json.Marshal(vi)
					vins = append(vins, string(bs))
				}
			}
			if voutsIf, ok := v["vout"].([]interface{}); ok {
				numVout = len(voutsIf)
			}
			// tx public key may be in extra field inside tx JSON; exact path may vary
			if extraField, ok := v["extra"].([]interface{}); ok {
				// search for pubkey hex in extra entries (heuristic)
				for _, e := range extraField {
					// typical extra entry may be string or map
					switch ee := e.(type) {
					case string:
						// ignore
					case map[string]interface{}:
						// maybe "tx_pub_key": "..."
						if pk, ok := ee["tx_pub_key"].(string); ok {
							txPubKey = sql.NullString{String: pk, Valid: true}
						}
					}
				}
			}
		}
	}

	var txExtraJSON []byte
	if txJSONStr != "" {
		txExtraJSON = []byte(txJSONStr)
	}
	var id uint64
	err = stmt.QueryRow(
		hash, height, blockTime, timeField,
		0, version, tree, txHash, txBlob, txExtraJSON, blockIndex, isRingCT,
		xmrhelper.NullIntToInterface(rctType), xmrhelper.NullStringToInterface(txPubKey),
		prunableSize, lockTime, expiry, size, spent, sent, fees, numVin, pq.Array(vins), numVout).Scan(&id)
	if err != nil {
		log.Errorf("XMR: Insert to transactions table unsuccessfully. Txhash: %s", txHash)
		return 0, 0, err
	}
	return id, fees, nil
}

func InsertMutilchainAddressOuts(db *sql.DB, dbAs []*dbtypes.MutilchainAddressRow, chainType string, checked bool) ([]uint64, error) {
	// Create the address table if it does not exist
	tableName := fmt.Sprintf("%saddresses", chainType)
	if haveTable, _ := TableExists(db, tableName); !haveTable {
		if err := CreateTable(db, tableName); err != nil {
			log.Errorf("Failed to create table %s: %v", tableName, err)
		}
	}

	dbtx, err := db.Begin()
	if err != nil {
		return nil, fmt.Errorf("unable to begin database transaction: %v", err)
	}

	stmt, err := dbtx.Prepare(mutilchainquery.MakeAddressRowInsertStatement(chainType, checked))
	if err != nil {
		log.Errorf("AddressRow INSERT prepare: %v ", err)
		_ = dbtx.Rollback() // try, but we want the Prepare error back
		return nil, err
	}

	ids := make([]uint64, 0, len(dbAs))
	for _, dbA := range dbAs {
		var id uint64
		err := stmt.QueryRow(dbA.Address, dbA.FundingTxDbID, dbA.FundingTxHash,
			dbA.FundingTxVoutIndex, dbA.VoutDbID, dbA.Value).Scan(&id)
		if err != nil {
			if err == sql.ErrNoRows {
				continue
			}
			_ = stmt.Close() // try, but we want the QueryRow error back
			if errRoll := dbtx.Rollback(); errRoll != nil {
				log.Errorf("Rollback failed: %v", errRoll)
			}
			return nil, err
		}
		ids = append(ids, id)
	}

	// Close prepared statement. Ignore errors as we'll Commit regardless.
	_ = stmt.Close()

	return ids, dbtx.Commit()
}

func SetMutilchainSpendingForFundingOP(db *sql.DB,
	fundingTxHash string, fundingTxVoutIndex uint32,
	spendingTxDbID uint64, spendingTxHash string, spendingTxVinIndex uint32,
	vinDbID uint64, chainType string) (int64, error) {

	res, err := db.Exec(mutilchainquery.SetAddressSpendingForOutpointFunc(chainType),
		fundingTxHash, fundingTxVoutIndex,
		spendingTxDbID, spendingTxHash, spendingTxVinIndex, vinDbID)
	if err != nil || res == nil {
		return 0, err
	}
	return res.RowsAffected()
}

func InsertMutilchainBlock(db *sql.DB, dbBlock *dbtypes.Block, isValid, checked bool, chainType string) (uint64, error) {
	insertStatement := mutilchainquery.MakeBlockInsertStatement(dbBlock, checked, chainType)
	var id uint64
	err := db.QueryRow(insertStatement,
		dbBlock.Hash, dbBlock.Height, dbBlock.Size, isValid, dbBlock.Version,
		"", "",
		dbBlock.NumTx, dbBlock.NumRegTx, dbBlock.NumStakeTx,
		dbBlock.Time.UNIX(), dbBlock.Nonce, dbBlock.VoteBits,
		nil, dbBlock.Voters, dbBlock.FreshStake,
		dbBlock.Revocations, dbBlock.PoolSize, dbBlock.Bits,
		dbBlock.SBits, dbBlock.Difficulty, nil,
		dbBlock.StakeVersion, dbBlock.PreviousHash, dbBlock.NumVins, dbBlock.NumVouts, dbBlock.Fees, dbBlock.TotalSent).Scan(&id)
	return id, err
}

// for btc/ltc (with xmr, use other function)
func InsertMutilchainWholeBlock(db *sql.DB, dbBlock *dbtypes.Block, isValid, checked bool, chainType string) (uint64, error) {
	insertStatement := mutilchainquery.MakeBlockAllInsertStatement(checked, chainType)
	var id uint64
	err := db.QueryRow(insertStatement,
		dbBlock.Hash, dbBlock.Height, dbBlock.Size, isValid, dbBlock.Version,
		dbBlock.NumTx, dbBlock.Time.UNIX(), dbBlock.Nonce, dbBlock.PoolSize, dbBlock.Bits,
		dbBlock.Difficulty, dbBlock.PreviousHash, dbBlock.NumVins, dbBlock.NumVouts, dbBlock.Fees, dbBlock.TotalSent).Scan(&id)
	return id, err
}

func InsertXMRWholeBlock(dbtx *sql.Tx, dbBlock *dbtypes.Block, blobBytes []byte, isValid, checked bool) (uint64, error) {
	insertStatement := mutilchainquery.MakeBlockAllInsertStatement(checked, mutilchain.TYPEXMR)
	stmt, err := dbtx.Prepare(insertStatement)
	if err != nil {
		log.Errorf("%s: Block INSERT prepare: %v", mutilchain.TYPEXMR, err)
		return 0, err
	}
	var id uint64
	err = stmt.QueryRow(dbBlock.Hash, dbBlock.Height, blobBytes,
		dbBlock.Size, isValid, dbBlock.Version,
		dbBlock.NumTx, dbBlock.Time.UNIX(),
		dbBlock.Nonce, dbBlock.PoolSize, dbBlock.Bits,
		dbBlock.Difficulty, dbBlock.DifficultyNum, dbBlock.CumulativeDifficulty,
		dbBlock.PowAlgo, dbBlock.PreviousHash, dbBlock.NumVins, dbBlock.NumVouts,
		dbBlock.Fees, dbBlock.TotalSent, dbBlock.Reward).Scan(&id)
	return id, err
}

func InsertMutilchainBlockPrevNext(db *sql.DB, blockDbID uint64,
	hash, prev, next string, chainType string) error {

	rows, err := db.Query(mutilchainquery.InsertBlockPrevNextStatement(chainType), blockDbID, prev, hash, next)
	if err == nil {
		return rows.Close()
	}
	return err
}

func UpdateMutilchainLastBlock(db *sql.DB, blockDbID uint64, isValid bool, chainType string) error {
	res, err := db.Exec(mutilchainquery.UpdateLastBlockValidStatement(chainType), blockDbID, isValid)
	if err != nil {
		return err
	}
	numRows, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if numRows != 1 {
		return fmt.Errorf("UpdateLastBlock failed to update exactly 1 row (%d)", numRows)
	}
	return nil
}

func UpdateMutilchainSyncedStatus(db *sql.DB, height uint64, chainType string) error {
	res, err := db.Exec(mutilchainquery.MakeUpdateBlockAllSynced(chainType), height)
	if err != nil {
		return err
	}
	numRows, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if numRows != 1 {
		return fmt.Errorf("%s: UpdateLastBlock failed to update exactly 1 row (%d)", chainType, numRows)
	}
	return nil
}

func UpdateXMRBlockSyncedStatus(dbtx *sql.Tx, height uint64, chainType string) error {
	stmt, err := dbtx.Prepare(mutilchainquery.MakeUpdateBlockAllSynced(chainType))
	if err != nil {
		log.Errorf("%s: Block synced flag update prepare: %v", mutilchain.TYPEXMR, err)
		return err
	}
	res, err := stmt.Exec(height)
	if err != nil {
		return err
	}
	numRows, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if numRows != 1 {
		return fmt.Errorf("%s: UpdateLastBlock failed to update exactly 1 row (%d)", chainType, numRows)
	}
	return nil
}

func UpdateMutilchainBlockNext(db *sql.DB, blockDbID uint64, next string, chainType string) error {
	res, err := db.Exec(mutilchainquery.UpdateBlockNextStatement(chainType), blockDbID, next)
	if err != nil {
		return err
	}
	numRows, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if numRows != 1 {
		return fmt.Errorf("UpdateMutilchainBlockNext failed to update exactly 1 row (%d)", numRows)
	}
	return nil
}

func RetrieveMutilchainAllVinDbIDs(db *sql.DB, chainType string) (vinDbIDs []uint64, err error) {
	rows, err := db.Query(mutilchainquery.SelectVinIDsALLFunc(chainType))
	if err != nil {
		return
	}
	defer func() {
		if e := rows.Close(); e != nil {
			log.Errorf("Close of Query failed: %v", e)
		}
	}()

	for rows.Next() {
		var id uint64
		err = rows.Scan(&id)
		if err != nil {
			break
		}

		vinDbIDs = append(vinDbIDs, id)
	}
	return
}

func (pgb *ChainDB) UpdateMutilchainSpendingInfoInAllAddresses(chainType string) (int64, error) {
	// Get the full list of vinDbIDs
	allVinDbIDs, err := RetrieveMutilchainAllVinDbIDs(pgb.db, chainType)
	if err != nil {
		log.Errorf("RetrieveAllVinDbIDs: %v", err)
		return 0, err
	}

	log.Infof("Updating spending tx info for %d addresses...", len(allVinDbIDs))
	var numAddresses int64
	for i := 0; i < len(allVinDbIDs); i += 1000 {
		//for i, vinDbID := range allVinDbIDs {
		if i%250000 == 0 {
			endRange := i + 250000 - 1
			if endRange > len(allVinDbIDs) {
				endRange = len(allVinDbIDs)
			}
			log.Infof("Updating from vins %d to %d...", i, endRange)
		}

		/*var numAddressRowsSet int64
		numAddressRowsSet, err = SetSpendingForVinDbID(pgb.db, vinDbID)
		if err != nil {
			log.Errorf("SetSpendingForFundingOP: %v", err)
			continue
		}
		numAddresses += numAddressRowsSet*/
		var numAddressRowsSet int64
		endChunk := i + 1000
		if endChunk > len(allVinDbIDs) {
			endChunk = len(allVinDbIDs)
		}
		_, numAddressRowsSet, err = SetMutilchainSpendingForVinDbIDs(pgb.db, allVinDbIDs[i:endChunk], chainType)
		if err != nil {
			log.Errorf("SetSpendingForFundingOP: %v", err)
			continue
		}
		numAddresses += numAddressRowsSet
	}

	return numAddresses, err
}

func SetMutilchainSpendingForVinDbIDs(db *sql.DB, vinDbIDs []uint64, chainType string) ([]int64, int64, error) {
	// get funding details for vin and set them in the address table
	dbtx, err := db.Begin()
	if err != nil {
		return nil, 0, fmt.Errorf(`unable to begin database transaction: %v`, err)
	}

	var vinGetStmt *sql.Stmt
	vinGetStmt, err = dbtx.Prepare(mutilchainquery.SelectAllVinInfoByIDFunc(chainType))
	if err != nil {
		log.Errorf("Vin SELECT prepare failed: %v", err)
		// Already up a creek. Just return error from Prepare.
		_ = dbtx.Rollback()
		return nil, 0, err
	}

	var addrSetStmt *sql.Stmt
	addrSetStmt, err = dbtx.Prepare(mutilchainquery.SetAddressSpendingForOutpointFunc(chainType))
	if err != nil {
		log.Errorf("address row UPDATE prepare failed: %v", err)
		// Already up a creek. Just return error from Prepare.
		_ = vinGetStmt.Close()
		_ = dbtx.Rollback()
		return nil, 0, err
	}

	bail := func() error {
		// Already up a creek. Just return error from Prepare.
		_ = vinGetStmt.Close()
		_ = addrSetStmt.Close()
		return dbtx.Rollback()
	}

	addressRowsUpdated := make([]int64, len(vinDbIDs))

	for iv, vinDbID := range vinDbIDs {
		// Get the funding tx outpoint (vins table) for the vin DB ID
		var prevOutHash, txHash string
		var prevOutVoutInd, txVinInd uint32
		var prevOutTree, txTree int8
		var id uint64
		err = vinGetStmt.QueryRow(vinDbID).Scan(&id,
			&txHash, &txVinInd, &txTree,
			&prevOutHash, &prevOutVoutInd, &prevOutTree)
		if err != nil {
			return addressRowsUpdated, 0, fmt.Errorf(`SetSpendingForVinDbIDs: `+
				`%v + %v (rollback)`, err, bail())
		}

		// skip coinbase inputs
		if bytes.Equal(zeroHashStringBytes, []byte(prevOutHash)) {
			continue
		}

		// Set the spending tx info (addresses table) for the vin DB ID
		var res sql.Result
		res, err = addrSetStmt.Exec(prevOutHash, prevOutVoutInd,
			0, txHash, txVinInd, vinDbID)
		if err != nil || res == nil {
			return addressRowsUpdated, 0, fmt.Errorf(`SetSpendingForVinDbIDs: `+
				`%v + %v (rollback)`, err, bail())
		}

		addressRowsUpdated[iv], err = res.RowsAffected()
		if err != nil {
			return addressRowsUpdated, 0, fmt.Errorf(`RowsAffected: `+
				`%v + %v (rollback)`, err, bail())
		}
	}

	// Close prepared statements. Ignore errors as we'll Commit regardless.
	_ = vinGetStmt.Close()
	_ = addrSetStmt.Close()

	var totalUpdated int64
	for _, n := range addressRowsUpdated {
		totalUpdated += n
	}

	return addressRowsUpdated, totalUpdated, dbtx.Commit()
}

func RetrieveMutilchainTransactionCount(ctx context.Context, db *sql.DB, chainType string) (int64, error) {
	var count int64
	err := db.QueryRowContext(ctx, mutilchainquery.MakeSelectTotalTransaction(chainType)).Scan(&count)
	return count, err
}

func RetrieveMutilchainVoutsCount(ctx context.Context, db *sql.DB, chainType string) (int64, error) {
	var count int64
	err := db.QueryRowContext(ctx, mutilchainquery.MakeCountTotalVouts(chainType)).Scan(&count)
	return count, err
}

func DeleteOlderThan20Blocks(ctx context.Context, db *sql.DB, chainType string, oldestBlockHeight int64) error {
	queryBuilder := mutilchainquery.MakeDeleteOlderThan20Blocks(chainType)
	_, err := db.Exec(queryBuilder, oldestBlockHeight)
	return err
}

func DeleteTxsOfOlderThan20Blocks(ctx context.Context, db *sql.DB, chainType string, oldestBlockHeight int64) error {
	queryBuilder := mutilchainquery.MakeDeleteTxsOfOlderThan20Blocks(chainType)
	_, err := db.Exec(queryBuilder, oldestBlockHeight)
	return err
}

func DeleteVinsOfOlderThan20Blocks(ctx context.Context, db *sql.DB, chainType string, oldestBlockHeight int64) error {
	queryBuilder := mutilchainquery.MakeDeleteVinsOfOlderThan20Blocks(chainType)
	_, err := db.Exec(queryBuilder, oldestBlockHeight)
	return err
}

func DeleteVoutsOfOlderThan20Blocks(ctx context.Context, db *sql.DB, chainType string, oldestBlockHeight int64) error {
	queryBuilder := mutilchainquery.MakeDeleteVoutsOfOlderThan20Blocks(chainType)
	_, err := db.Exec(queryBuilder, oldestBlockHeight)
	return err
}

func CheckBlockExistOnDB(ctx context.Context, db *sql.DB, chainType string, height int64) (bool, error) {
	queryBuilder := mutilchainquery.MakeCheckExistBLock(chainType)
	var exist bool
	err := db.QueryRowContext(ctx, queryBuilder, height).Scan(&exist)
	return exist, err
}

func RetrieveMutilchainAddressesCount(ctx context.Context, db *sql.DB, chainType string) (int64, error) {
	var count int64
	err := db.QueryRowContext(ctx, mutilchainquery.MakeSelectCountTotalAddress(chainType)).Scan(&count)
	return count, err
}
