package dcrpg

import (
	"bytes"
	"context"
	"database/sql"
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

func InsertMutilchainVouts(dbtx *sql.Tx, dbVouts []*dbtypes.Vout, checked bool, chainType string) ([]uint64, []dbtypes.MutilchainAddressRow, error) {
	addressRows := make([]dbtypes.MutilchainAddressRow, 0, len(dbVouts)*2)
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

	return ids, addressRows, nil
}

func InsertMutilchainWholeVouts(dbtx *sql.Tx, dbVouts []*dbtypes.Vout, checked bool, chainType string) ([]uint64, []dbtypes.MutilchainAddressRow, error) {
	addressRows := make([]dbtypes.MutilchainAddressRow, 0, len(dbVouts)*2)
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

	return ids, addressRows, nil
}

func InsertMutilchainVins(dbtx *sql.Tx, dbVins dbtypes.VinTxPropertyARRAY, chainType string, checked bool) ([]uint64, error) {
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

	return ids, nil
}

func InsertMutilchainWholeVins(sqlTx *sql.Tx, dbVins dbtypes.VinTxPropertyARRAY, chainType string, checked bool) ([]uint64, error) {
	queryBuilder := mutilchainquery.InsertVinAllRowFuncCheck(checked, chainType)
	stmt, err := sqlTx.Prepare(queryBuilder)
	if err != nil {
		log.Errorf("%s: Vin INSERT prepare: %v", chainType, err)
		_ = sqlTx.Rollback() // try, but we want the Prepare error back
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
			if errRoll := sqlTx.Rollback(); errRoll != nil {
				log.Errorf("Rollback failed: %v", errRoll)
			}
			return ids, fmt.Errorf("%s: InsertVins INSERT exec failed: %v", chainType, err)
		}
		ids = append(ids, id)
	}

	// Close prepared statement. Ignore errors as we'll Commit regardless.
	_ = stmt.Close()

	return ids, nil
}

func InsertMutilchainTxns(sqlTx *sql.Tx, dbTxns []*dbtypes.Tx, checked bool, chainType string) ([]uint64, error) {
	stmt, err := sqlTx.Prepare(mutilchainquery.MakeTxInsertStatement(checked, chainType))
	if err != nil {
		log.Errorf("%s: Txns INSERT prepare: %v", chainType, err)
		_ = sqlTx.Rollback() // try, but we want the Prepare error back
		return nil, err
	}

	ids := make([]uint64, 0, len(dbTxns))
	for _, tx := range dbTxns {
		var id uint64
		//TODO: uncomment lock_time
		err := stmt.QueryRow(
			tx.BlockHash, tx.BlockHeight, tx.BlockTime.UNIX(), tx.Time.UNIX(),
			tx.TxType, tx.Version, tx.TxID, tx.BlockIndex,
			tx.Locktime, tx.Size, tx.Spent, tx.Sent, tx.Fees,
			tx.NumVin, tx.NumVout).Scan(&id)
		if err != nil {
			if err == sql.ErrNoRows {
				log.Errorf("%s: Insert to transactions table unsuccessfully. Height: %d", chainType, tx.BlockHeight)
				continue
			}
			_ = stmt.Close() // try, but we want the QueryRow error back
			if errRoll := sqlTx.Rollback(); errRoll != nil {
				log.Errorf("Rollback failed: %v", errRoll)
			}
			return nil, err
		}
		ids = append(ids, id)
	}

	// Close prepared statement. Ignore errors as we'll Commit regardless.
	_ = stmt.Close()

	return ids, nil
}

func ParseAndStoreTxJSON(dbtx *sql.Tx, txHash string, blockHeight uint64, txJSONStr string, checked, isCoinbase bool) (*xmrParseTxResult, error) {
	// parse into map
	var txMap map[string]interface{}
	if err := json.Unmarshal([]byte(txJSONStr), &txMap); err != nil {
		return nil, fmt.Errorf("unmarshal tx json: %v", err)
	}
	voutstmt, err := dbtx.Prepare(mutilchainquery.MakeInsertMoneroVoutsAllRowQuery(checked))
	if err != nil {
		log.Errorf("%s: monero_outputs INSERT prepare: %v", mutilchain.TYPEXMR, err)
		return nil, err
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
		return nil, err
	}

	keyImgStmt, err := dbtx.Prepare(mutilchainquery.MakeInsertMoneroKeyImagesQuery(checked))
	if err != nil {
		voutstmt.Close()
		// voutAddrStmt.Close()
		ringMemberStmt.Close()
		log.Errorf("%s: monero_key_images INSERT prepare: %v", mutilchain.TYPEXMR, err)
		return nil, err
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
		return nil, err
	}

	defer func() {
		voutstmt.Close()
		// voutAddrStmt.Close()
		ringMemberStmt.Close()
		keyImgStmt.Close()
		// vinstmt.Close()
		rctDataStmt.Close()
	}()

	parseRes := &xmrParseTxResult{}
	// 1) vout parsing -> monero_outputs
	if voutIf, ok := txMap["vout"].([]interface{}); ok {
		if !isCoinbase {
			parseRes.numVouts += len(voutIf)
		}
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
				if !isCoinbase {
					parseRes.totalSent += amount
				}
				var mvoutid uint64
				err := voutstmt.QueryRow(txHash, idx, xmrhelper.NullInt64ToInterface(globalIndex), outPk, nil, amountKnown, xmrhelper.NullInt64ToInterface(amount)).Scan(&mvoutid)
				// insert into monero_outputs
				if err != nil {
					log.Warnf("XMR: insertMoneroOutput - Looks like duplicate on db, ignore: %v", err)
				}
			}
		}
	}

	// 2) vin parsing -> vins_all, key_images, ring members
	if vinIf, ok := txMap["vin"].([]interface{}); ok {
		if !isCoinbase {
			parseRes.numVins += len(vinIf)
		}
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
							log.Warnf("XMR: insertRingMember - Looks like duplicate on db, ignore: %v", err)
						}
					}
					if !isCoinbase {
						ringSize := len(globalIdxs)
						parseRes.ringSize += ringSize
						if ringSize >= 15 {
							parseRes.decoyGe15Num++
						} else if ringSize >= 12 {
							parseRes.decoy1214Num++
						} else if ringSize >= 8 {
							parseRes.decoy811Num++
						} else if ringSize >= 4 {
							parseRes.decoy47Num++
						} else {
							parseRes.decoy03Num++
						}
					}
					vinamount := int64(0)
					if a, amok := keyObj["amount"].(float64); amok {
						vinamount = int64(a)
					}
					// key image k_image (if present)
					if ki, ok5 := keyObj["k_image"].(string); ok5 && ki != "" {
						var id uint64
						err = keyImgStmt.QueryRow(ki, nil, nil, txHash, blockHeight, time.Now().Unix(), vinamount).Scan(&id)
						if err != nil {
							log.Warnf("XMR: insertKeyImage - Looks like duplicate on db, ignore: %v", err)
						}
					}
				}
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
			log.Warnf("XMR: insertRctData - Looks like duplicate on db, ignore: %v", err)
		}
	}
	// done
	return parseRes, nil
}

func GetXmrTxParseJSONSimpleData(txJSONStr string) (xmrParseTxResult, error) {
	parseRes := xmrParseTxResult{}
	// parse into map
	var txMap map[string]interface{}
	if err := json.Unmarshal([]byte(txJSONStr), &txMap); err != nil {
		return parseRes, fmt.Errorf("unmarshal tx json: %v", err)
	}
	isRingCt := false
	sumIn := int64(0)
	sumOut := int64(0)
	if rct, ok := txMap["rct_signatures"].(map[string]interface{}); ok {
		isRingCt = true
		if feeIf, ok := rct["txnFee"].(float64); ok {
			parseRes.fees = int64(feeIf)
		}
	}
	// 1) vout parsing -> monero_outputs
	if voutIf, ok := txMap["vout"].([]interface{}); ok {
		parseRes.numVouts += len(voutIf)
		for _, vo := range voutIf {
			if voMap, ok := vo.(map[string]interface{}); ok {
				if amt, ok := voMap["amount"]; ok {
					amount := int64(0)
					switch v := amt.(type) {
					case float64:
						amount = int64(v)
					case string:
						if parsed, err := xmrhelper.ParseInt64FromString(v); err == nil {
							amount = parsed
						}
					}
					sumOut += amount
				}
			}
		}
	}

	// 2) vin parsing -> vins_all, key_images, ring members
	if vinIf, ok := txMap["vin"].([]interface{}); ok {
		parseRes.numVins += len(vinIf)
		for _, vinItem := range vinIf {
			if vinMap, ok2 := vinItem.(map[string]interface{}); ok2 {
				// --- Key input style (most typical for modern Monero) ---
				if keyObj, ok3 := vinMap["key"].(map[string]interface{}); ok3 {
					if a, ok31 := keyObj["amount"].(float64); ok31 {
						sumIn += int64(a)
					}
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
					ringSize := len(globalIdxs)
					parseRes.ringSize += ringSize
					if ringSize >= 15 {
						parseRes.decoyGe15Num++
					} else if ringSize >= 12 {
						parseRes.decoy1214Num++
					} else if ringSize >= 8 {
						parseRes.decoy811Num++
					} else if ringSize >= 4 {
						parseRes.decoy47Num++
					} else {
						parseRes.decoy03Num++
					}
				}
			}
		}
	}
	if parseRes.fees == 0 && !isRingCt {
		parseRes.fees = sumIn - sumOut
	}
	parseRes.totalSent = sumOut
	// done
	return parseRes, nil
}

func InsertXMRTxn(dbtx *sql.Tx, height uint32, hash string, blockTime, blockIndex int64, txHash, txHex, txJSONStr string, checked, isCoinbase bool) (uint64, int64, int, error) {
	stmt, err := dbtx.Prepare(mutilchainquery.MakeTxInsertStatement(checked, mutilchain.TYPEXMR))
	if err != nil {
		log.Errorf("%s: Txns INSERT prepare: %v", mutilchain.TYPEXMR, err)
		return 0, 0, 0, err
	}
	defer stmt.Close()
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
	isRingCT := false
	rctType := sql.NullInt64{}
	txPubKey := sql.NullString{}
	prunableSize := sql.NullInt64{}
	size := 0
	if txHex != "" {
		size = len(txHex) / 2
	}
	fees := int64(0)
	numVin := 0
	vins := []string{}
	numVout := 0
	var sumOut int64 = 0
	var sumIn int64 = 0
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
					if !isRingCT && !isCoinbase {
						if vinMap, ok := vi.(map[string]interface{}); ok {
							// coinbase tx có "gen" thay vì "key" -> skip
							if keyObj, ok := vinMap["key"].(map[string]interface{}); ok {
								if a, ok2 := keyObj["amount"].(float64); ok2 {
									sumIn += int64(a)
								}
							}
						}
					}
				}
			}
			if voutsIf, ok := v["vout"].([]interface{}); ok {
				numVout = len(voutsIf)
				if !isRingCT && !isCoinbase {
					for _, vo := range voutsIf {
						if voutMap, ok := vo.(map[string]interface{}); ok {
							if a, ok := voutMap["amount"].(float64); ok {
								sumOut += int64(a)
							}
						}
					}
				}
			}
			if fees == 0 && !isRingCT {
				fees = sumIn - sumOut
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
	var id uint64
	err = stmt.QueryRow(
		hash, height, blockTime, timeField,
		0, version, txHash, blockIndex, isRingCT,
		xmrhelper.NullIntToInterface(rctType), xmrhelper.NullStringToInterface(txPubKey),
		prunableSize, size, sumIn, sumOut, fees, numVin, numVout, isCoinbase).Scan(&id)
	if err != nil {
		log.Warnf("XMR: InsertXMRTxn - Looks like duplicate on db, ignore: %v", err)
	}
	return id, fees, size, nil
}

func InsertMutilchainAddressOuts(dbtx *sql.Tx, dbAs []*dbtypes.MutilchainAddressRow, chainType string, checked bool) ([]uint64, error) {
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

	return ids, nil
}

func SetMutilchainSpendingForFundingOP(dbtx *sql.Tx,
	fundingTxHash string, fundingTxVoutIndex uint32,
	spendingTxDbID uint64, spendingTxHash string, spendingTxVinIndex uint32,
	vinDbID uint64, chainType string) (int64, error) {

	stmt, err := dbtx.Prepare(mutilchainquery.SetAddressSpendingForOutpointFunc(chainType))
	if err != nil {
		log.Errorf("%s: Address Spending Update failed: %v", chainType, err)
		_ = dbtx.Rollback() // try, but we want the Prepare error back
		return 0, err
	}
	res, err := stmt.Exec(fundingTxHash, fundingTxVoutIndex,
		spendingTxDbID, spendingTxHash, spendingTxVinIndex, vinDbID)
	if err != nil || res == nil {
		_ = stmt.Close() // try, but we want the QueryRow error back
		if errRoll := dbtx.Rollback(); errRoll != nil {
			log.Errorf("Rollback failed: %v", errRoll)
		}
		return 0, err
	}
	numAddr, err := res.RowsAffected()
	if err != nil {
		_ = stmt.Close() // try, but we want the QueryRow error back
		if errRoll := dbtx.Rollback(); errRoll != nil {
			log.Errorf("Rollback failed: %v", errRoll)
		}
		return 0, err
	}
	_ = stmt.Close()
	return numAddr, nil
}

func InsertMutilchainBlock(dbtx *sql.Tx, dbBlock *dbtypes.Block, isValid, checked bool, chainType string) (uint64, error) {
	insertStatement := mutilchainquery.MakeBlockInsertStatement(dbBlock, checked, chainType)
	stmt, err := dbtx.Prepare(insertStatement)
	if err != nil {
		log.Errorf("%s: Block INSERT prepare: %v", chainType, err)
		return 0, err
	}
	var id uint64
	err = stmt.QueryRow(dbBlock.Hash, dbBlock.Height, dbBlock.Size, isValid, dbBlock.Version,
		"", "",
		dbBlock.NumTx, dbBlock.NumRegTx, dbBlock.NumStakeTx,
		dbBlock.Time.UNIX(), dbBlock.Nonce, dbBlock.VoteBits,
		nil, dbBlock.Voters, dbBlock.FreshStake,
		dbBlock.Revocations, dbBlock.PoolSize, dbBlock.Bits,
		dbBlock.SBits, dbBlock.Difficulty, nil,
		dbBlock.StakeVersion, dbBlock.PreviousHash, dbBlock.NumVins, dbBlock.NumVouts, dbBlock.Fees, dbBlock.TotalSent).Scan(&id)
	if err != nil {
		_ = stmt.Close() // try, but we want the QueryRow error back
		if errRoll := dbtx.Rollback(); errRoll != nil {
			log.Errorf("Rollback failed: %v", errRoll)
		}
		return 0, err
	}
	_ = stmt.Close()
	return id, nil
}

func UpdateMutilchainBlock(db *sql.DB, dbBlock *dbtypes.Block, isValid bool, chainType string) (uint64, error) {
	updateStatement := mutilchainquery.MakeUpdateBlockRowStatement(chainType)
	var id uint64
	err := db.QueryRow(updateStatement,
		dbBlock.Height, dbBlock.Size, isValid, dbBlock.Version,
		dbBlock.NumTx, dbBlock.Nonce, dbBlock.Difficulty, dbBlock.NumVins, dbBlock.NumVouts, dbBlock.Fees, dbBlock.TotalSent).Scan(&id)
	return id, err
}

// for btc/ltc (with xmr, use other function)
func InsertMutilchainWholeBlock(dbtx *sql.Tx, dbBlock *dbtypes.Block, isValid, checked bool, chainType string) (uint64, error) {
	insertStatement := mutilchainquery.MakeBlockAllInsertStatement(checked, chainType)
	stmt, err := dbtx.Prepare(insertStatement)
	if err != nil {
		log.Errorf("%s: Block INSERT prepare: %v", chainType, err)
		return 0, err
	}
	var id uint64
	err = stmt.QueryRow(dbBlock.Hash, dbBlock.Height, dbBlock.Size, isValid, dbBlock.Version,
		dbBlock.NumTx, dbBlock.Time.UNIX(), dbBlock.Nonce, dbBlock.PoolSize, dbBlock.Bits,
		dbBlock.Difficulty, dbBlock.PreviousHash, dbBlock.NumVins, dbBlock.NumVouts, dbBlock.Fees, dbBlock.TotalSent).Scan(&id)
	if err != nil {
		_ = stmt.Close() // try, but we want the QueryRow error back
		if errRoll := dbtx.Rollback(); errRoll != nil {
			log.Errorf("Rollback failed: %v", errRoll)
		}
		return 0, err
	}
	return id, nil
}

func InsertXMRWholeBlock(dbtx *sql.Tx, dbBlock *dbtypes.Block, isValid, checked bool, txsParseRes storeTxnsResult) (uint64, error) {
	insertStatement := mutilchainquery.MakeBlockAllInsertStatement(checked, mutilchain.TYPEXMR)
	stmt, err := dbtx.Prepare(insertStatement)
	if err != nil {
		log.Errorf("%s: Block INSERT prepare: %v", mutilchain.TYPEXMR, err)
		return 0, err
	}
	var id uint64
	err = stmt.QueryRow(dbBlock.Hash, dbBlock.Height,
		txsParseRes.totalSize, isValid, dbBlock.Version,
		dbBlock.NumTx, dbBlock.Time.UNIX(),
		dbBlock.Nonce, dbBlock.PoolSize, dbBlock.Bits,
		dbBlock.Difficulty, dbBlock.DifficultyNum, dbBlock.CumulativeDifficulty,
		dbBlock.PowAlgo, dbBlock.PreviousHash, dbBlock.NumVins, dbBlock.NumVouts,
		dbBlock.Fees, dbBlock.TotalSent, dbBlock.Reward, txsParseRes.ringSize,
		txsParseRes.avgRingSize, txsParseRes.feePerKb, txsParseRes.avgTxSize,
		txsParseRes.decoy03, txsParseRes.decoy47, txsParseRes.decoy811,
		txsParseRes.decoy1214, txsParseRes.decoyGe15, true).Scan(&id)
	if err != nil {
		_ = stmt.Close() // try, but we want the QueryRow error back
		if errRoll := dbtx.Rollback(); errRoll != nil {
			log.Errorf("Rollback failed: %v", errRoll)
		}
		return 0, err
	}
	return id, err
}

func InsertMutilchainBlockPrevNext(dbtx *sql.Tx, blockDbID uint64,
	hash, prev, next string, chainType string) error {
	stmt, err := dbtx.Prepare(mutilchainquery.InsertBlockPrevNextStatement(chainType))
	if err != nil {
		log.Errorf("%s: INSERT block prev next prepare failed: %v", chainType, err)
		return err
	}
	_, err = stmt.Exec(blockDbID, prev, hash, next)
	if err != nil {
		_ = stmt.Close() // try, but we want the QueryRow error back
		if errRoll := dbtx.Rollback(); errRoll != nil {
			log.Errorf("Rollback failed: %v", errRoll)
		}
		return err
	}
	_ = stmt.Close()
	return nil
}

func UpdateMutilchainLastBlock(dbtx *sql.Tx, blockDbID uint64, isValid bool, chainType string) error {
	stmt, err := dbtx.Prepare(mutilchainquery.UpdateLastBlockValidStatement(chainType))
	if err != nil {
		log.Errorf("%s: Block Update last block prepare: %v", chainType, err)
		return err
	}
	res, err := stmt.Exec(blockDbID, isValid)
	if err != nil {
		_ = stmt.Close() // try, but we want the QueryRow error back
		if errRoll := dbtx.Rollback(); errRoll != nil {
			log.Errorf("Rollback failed: %v", errRoll)
		}
		return err
	}
	numRows, err := res.RowsAffected()
	if err != nil {
		_ = stmt.Close() // try, but we want the QueryRow error back
		if errRoll := dbtx.Rollback(); errRoll != nil {
			log.Errorf("Rollback failed: %v", errRoll)
		}
		return err
	}
	if numRows != 1 {
		_ = stmt.Close() // try, but we want the QueryRow error back
		if errRoll := dbtx.Rollback(); errRoll != nil {
			log.Errorf("Rollback failed: %v", errRoll)
		}
		return fmt.Errorf("UpdateLastBlock failed to update exactly 1 row (%d)", numRows)
	}
	_ = stmt.Close()
	return nil
}

func UpdateMutilchainSyncedStatus(dbtx *sql.Tx, height uint64, chainType string) error {
	stmt, err := dbtx.Prepare(mutilchainquery.MakeUpdateBlockAllSynced(chainType))
	if err != nil {
		log.Errorf("%s: Block synced flag update prepare: %v", chainType, err)
		return err
	}
	res, err := stmt.Exec(height)
	if err != nil {
		_ = stmt.Close() // try, but we want the QueryRow error back
		if errRoll := dbtx.Rollback(); errRoll != nil {
			log.Errorf("Rollback failed: %v", errRoll)
		}
		return err
	}
	numRows, err := res.RowsAffected()
	if err != nil {
		_ = stmt.Close() // try, but we want the QueryRow error back
		if errRoll := dbtx.Rollback(); errRoll != nil {
			log.Errorf("Rollback failed: %v", errRoll)
		}
		return err
	}
	if numRows != 1 {
		_ = stmt.Close() // try, but we want the QueryRow error back
		if errRoll := dbtx.Rollback(); errRoll != nil {
			log.Errorf("Rollback failed: %v", errRoll)
		}
		return fmt.Errorf("%s: UpdateLastBlock failed to update exactly 1 row (%d)", chainType, numRows)
	}
	_ = stmt.Close()
	return nil
}

// func UpdateXMRBlockSyncedStatus(dbtx *sql.Tx, height uint64, chainType string) error {
// 	stmt, err := dbtx.Prepare(mutilchainquery.MakeUpdateBlockAllSynced(chainType))
// 	if err != nil {
// 		log.Errorf("%s: Block synced flag update prepare: %v", mutilchain.TYPEXMR, err)
// 		return err
// 	}
// 	res, err := stmt.Exec(height)
// 	if err != nil {
// 		return err
// 	}
// 	numRows, err := res.RowsAffected()
// 	if err != nil {
// 		return err
// 	}
// 	if numRows != 1 {
// 		return fmt.Errorf("%s: UpdateLastBlock failed to update exactly 1 row (%d)", chainType, numRows)
// 	}
// 	return nil
// }

func UpdateMutilchainBlockNext(dbtx *sql.Tx, blockDbID uint64, next string, chainType string) error {
	stmt, err := dbtx.Prepare(mutilchainquery.UpdateBlockNextStatement(chainType))
	if err != nil {
		log.Errorf("%s: Block Update block next prepare: %v", chainType, err)
		return err
	}
	res, err := stmt.Exec(blockDbID, next)
	if err != nil {
		_ = stmt.Close() // try, but we want the QueryRow error back
		if errRoll := dbtx.Rollback(); errRoll != nil {
			log.Errorf("Rollback failed: %v", errRoll)
		}
		return err
	}
	numRows, err := res.RowsAffected()
	if err != nil {
		_ = stmt.Close() // try, but we want the QueryRow error back
		if errRoll := dbtx.Rollback(); errRoll != nil {
			log.Errorf("Rollback failed: %v", errRoll)
		}
		return err
	}
	if numRows != 1 {
		_ = stmt.Close() // try, but we want the QueryRow error back
		if errRoll := dbtx.Rollback(); errRoll != nil {
			log.Errorf("Rollback failed: %v", errRoll)
		}
		return fmt.Errorf("UpdateMutilchainBlockNext failed to update exactly 1 row (%d)", numRows)
	}
	_ = stmt.Close()
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
