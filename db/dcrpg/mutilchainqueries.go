package dcrpg

import (
	"bytes"
	"context"
	"database/sql"
	"fmt"

	"github.com/decred/dcrdata/db/dcrpg/v8/internal/mutilchainquery"
	"github.com/decred/dcrdata/v8/db/dbtypes"
	"github.com/lib/pq"
)

func RetrieveMutilchainBestBlockHeight(db *sql.DB, chainType string) (height uint64, hash string, id uint64, err error) {
	err = db.QueryRow(mutilchainquery.RetrieveBestBlockHeightStatement(chainType)).Scan(&id, &hash, &height)
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

func InsertMutilchainWholeBlock(db *sql.DB, dbBlock *dbtypes.Block, isValid, checked bool, chainType string) (uint64, error) {
	insertStatement := mutilchainquery.MakeBlockAllInsertStatement(dbBlock, checked, chainType)
	var id uint64
	err := db.QueryRow(insertStatement,
		dbBlock.Hash, dbBlock.Height, dbBlock.Size, isValid, dbBlock.Version,
		dbBlock.NumTx, dbBlock.Time.UNIX(), dbBlock.Nonce, dbBlock.PoolSize, dbBlock.Bits,
		dbBlock.Difficulty, dbBlock.PreviousHash, dbBlock.NumVins, dbBlock.NumVouts, dbBlock.Fees, dbBlock.TotalSent).Scan(&id)
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
