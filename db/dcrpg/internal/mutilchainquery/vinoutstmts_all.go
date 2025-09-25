package mutilchainquery

import (
	"fmt"
)

const (
	// vins
	CreateVinAllTable = `CREATE TABLE IF NOT EXISTS %svins_all (
		id SERIAL8 PRIMARY KEY,
		tx_hash TEXT,
		tx_index INT4,
		tx_tree INT2,
		prev_tx_hash TEXT,
		prev_tx_index INT8,
		prev_tx_tree INT2,
		value_in INT8
	);`

	InsertVinAllRow0 = `INSERT INTO %svins_all (tx_hash, tx_index, tx_tree, prev_tx_hash, prev_tx_index, prev_tx_tree, value_in)
		VALUES ($1, $2, $3, $4, $5, $6, $7) `
	InsertVinAllRow        = InsertVinAllRow0 + `RETURNING id;`
	InsertVinAllRowChecked = InsertVinAllRow0 +
		`ON CONFLICT (tx_hash, tx_index) DO NOTHING RETURNING id;`

	IndexVinAllTableOnVins = `CREATE UNIQUE INDEX uix_%svin_all_txhash_txindex
		ON %svins_all(tx_hash, tx_index);` // STORING (prev_tx_hash, prev_tx_index)
	IndexVinAllTableOnPrevOuts = `CREATE INDEX uix_%svin_all_prevout
		ON %svins_all(prev_tx_hash, prev_tx_index)
		;` // STORING (tx_hash, tx_index)
	DeindexVinAllTableOnVins     = `DROP INDEX uix_%svin_all_txhash_txindex;`
	DeindexVinAllTableOnPrevOuts = `DROP INDEX uix_%svin_all_prevout;`

	SelectVinAllIDsALL = `SELECT id FROM %svins_all;`

	SelectSpendingAllTxsByPrevTx = `SELECT id, tx_hash, tx_index, prev_tx_index FROM %svins_all WHERE prev_tx_hash=$1;`
	SelectSpendingAllTxByPrevOut = `SELECT id, tx_hash, tx_index FROM %svins_all 
		WHERE prev_tx_hash=$1 AND prev_tx_index=$2;`
	SelectFundingAllTxsByTx        = `SELECT id, prev_tx_hash FROM %svins_all WHERE tx_hash=$1;`
	SelectFundingAllTxByTxIn       = `SELECT id, prev_tx_hash FROM %svins_all WHERE tx_hash=$1 AND tx_index=$2;`
	SelectFundingAllOutpointByTxIn = `SELECT id, prev_tx_hash, prev_tx_index, prev_tx_tree FROM %svins_all 
		WHERE tx_hash=$1 AND tx_index=$2;`
	SelectFundingAllOutpointByVinID     = `SELECT prev_tx_hash, prev_tx_index, prev_tx_tree FROM %svins_all WHERE id=$1;`
	SelectSpendingAllTxByVinID          = `SELECT tx_hash, tx_index, tx_tree FROM %svins_all WHERE id=$1;`
	SelectAllVinAllInfoByID             = `SELECT * FROM %svins_all WHERE id=$1;`
	SelectFundingAllOutpointIndxByVinID = `SELECT prev_tx_index FROM %svins_all WHERE id=$1;`

	SelectPkScriptAllByVinID = `SELECT version, pkscript FROM %svouts_all
		JOIN %svins_all ON %svouts_all.tx_hash=%svins_all.prev_tx_hash and %svouts_all.tx_index=%svins_all.prev_tx_index
		WHERE %svins_all.id=$1;`

	DeleteVinAllWithTxHashArray     = `DELETE FROM %svins_all WHERE tx_hash = ANY($1)`
	CheckAndRemoveDuplicateVinsRows = `WITH duplicates AS (
		SELECT id, row_number() OVER (PARTITION BY tx_hash, tx_index ORDER BY id) AS rn
		FROM public.%svins_all
		WHERE tx_hash IS NOT NULL AND tx_index IS NOT NULL)
		DELETE FROM public.%svins_all v
		USING duplicates d
		WHERE v.id = d.id
		AND d.rn > 1;`

	// vouts

	CreateVoutAllTable = `CREATE TABLE IF NOT EXISTS %svouts_all (
		id SERIAL8 PRIMARY KEY,
		tx_hash TEXT,
		tx_index INT4,
		tx_tree INT2,
		value INT8,
		version INT2,
		pkscript BYTEA,
		script_req_sigs INT4,
		script_type TEXT,
		monero_output_id INT8,
		script_addresses TEXT[]
	);`

	insertVoutAllRow0 = `INSERT INTO %svouts_all (tx_hash, tx_index, tx_tree, value, 
		version, pkscript, script_req_sigs, script_type, script_addresses)
	VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) `
	insertVoutAllRow               = insertVoutAllRow0 + `RETURNING id;`
	insertVoutAllRowChecked        = insertVoutAllRow0 + `ON CONFLICT (tx_hash, tx_index) DO NOTHING RETURNING id;`
	CountTotalVoutsAll             = `SELECT count(*) FROM %svouts_all;`
	SelectPkScriptByIDFromVoutsAll = `SELECT pkscript FROM %svouts_all WHERE id=$1;`
	SelectVoutAllIDByOutpoint      = `SELECT id FROM %svouts_all WHERE tx_hash=$1 and tx_index=$2;`
	SelectVoutAllByID              = `SELECT * FROM %svouts_all WHERE id=$1;`

	RetrieveVoutAllValue  = `SELECT value FROM %svouts_all WHERE tx_hash=$1 and tx_index=$2;`
	RetrieveVoutAllValues = `SELECT value, tx_index, tx_tree FROM %svouts_all WHERE tx_hash=$1;`

	IndexVoutAllTableOnTxHashIdx = `CREATE UNIQUE INDEX uix_%svout_all_txhash_ind
		ON %svouts_all(tx_hash, tx_index);`
	DeindexVoutAllTableOnTxHashIdx = `DROP INDEX uix_%svout_all_txhash_ind;`

	IndexVoutAllTableOnTxHash = `CREATE INDEX uix_%svout_all_txhash
		ON %svouts_all(tx_hash);`
	DeindexVoutAllTableOnTxHash      = `DROP INDEX uix_%svout_all_txhash;`
	CheckAndRemoveDuplicateVoutsRows = `WITH duplicates AS (
		SELECT id, row_number() OVER (PARTITION BY tx_hash, tx_index ORDER BY id) AS rn
		FROM public.%svouts_all
		WHERE tx_hash IS NOT NULL AND tx_index IS NOT NULL)
		DELETE FROM public.%svouts_all v
		USING duplicates d
		WHERE v.id = d.id
		AND d.rn > 1;`
)

func MakeCountTotalVoutsAll(chainType string) string {
	return fmt.Sprintf(CountTotalVoutsAll, chainType)
}

func MakeSelectFundingAllOutpointIndxByVinID(chainType string) string {
	return fmt.Sprintf(SelectFundingAllOutpointIndxByVinID, chainType)
}

func MakeSelectSpendingAllTxsByPrevTx(chainType string) string {
	return fmt.Sprintf(SelectSpendingAllTxsByPrevTx, chainType)
}

func MakeSelectPkScriptAllByVinID(chainType string) string {
	return fmt.Sprintf(SelectPkScriptAllByVinID, chainType, chainType, chainType, chainType, chainType, chainType, chainType)
}

func MakeSelectSpendingAllTxByPrevOut(chainType string) string {
	return fmt.Sprintf(SelectSpendingAllTxByPrevOut, chainType)
}

func MakeSelectVoutAllByID(chainType string) string {
	return fmt.Sprintf(SelectVoutAllByID, chainType)
}

func MakeVoutAllInsertStatement(checked bool, chainType string) string {
	if checked {
		return fmt.Sprintf(insertVoutAllRowChecked, chainType)
	}
	return fmt.Sprintf(insertVoutAllRow, chainType)
}

func CreateVinAllTableFunc(chainType string) string {
	return fmt.Sprintf(CreateVinAllTable, chainType)
}

func CreateVoutAllTableFunc(chainType string) string {
	return fmt.Sprintf(CreateVoutAllTable, chainType)
}

func InsertVinAllRowFunc(chainType string) string {
	return fmt.Sprintf(InsertVinAllRow, chainType)
}

func InsertVinAllRowFuncCheck(checked bool, chainType string) string {
	if checked {
		return fmt.Sprintf(InsertVinAllRowChecked, chainType)
	}
	return fmt.Sprintf(InsertVinAllRow, chainType)
}

func SelectVinAllIDsALLFunc(chainType string) string {
	return fmt.Sprintf(SelectVinAllIDsALL, chainType)
}

func SelectAllVinAllInfoByIDFunc(chainType string) string {
	return fmt.Sprintf(SelectAllVinAllInfoByID, chainType)
}

func MakeIndexVinAllTableOnVins(chainType string) string {
	return fmt.Sprintf(IndexVinAllTableOnVins, chainType, chainType)
}

func MakeDeindexVinAllTableOnVins(chainType string) string {
	return fmt.Sprintf(DeindexVinAllTableOnVins, chainType)
}

func MakeIndexVinAllTableOnPrevOuts(chainType string) string {
	return fmt.Sprintf(IndexVinAllTableOnPrevOuts, chainType, chainType)
}

func MakeDeindexVinAllTableOnPrevOuts(chainType string) string {
	return fmt.Sprintf(DeindexVinAllTableOnPrevOuts, chainType)
}

func MakeIndexVoutAllTableOnTxHashIdx(chainType string) string {
	return fmt.Sprintf(IndexVoutAllTableOnTxHashIdx, chainType, chainType)
}

func MakeDeindexVoutAllTableOnTxHashIdx(chainType string) string {
	return fmt.Sprintf(DeindexVoutAllTableOnTxHashIdx, chainType)
}

func MakeIndexVoutAllTableOnTxHash(chainType string) string {
	return fmt.Sprintf(IndexVoutAllTableOnTxHash, chainType, chainType)
}

func MakeDeindexVoutAllTableOnTxHash(chainType string) string {
	return fmt.Sprintf(DeindexVoutAllTableOnTxHash, chainType)
}

func MakeDeleteVinAllWithTxHashArrayQuery(chainType string) string {
	return fmt.Sprintf(DeleteVinAllWithTxHashArray, chainType)
}

func CreateCheckAndRemoveDuplicateVinsRowsQuery(chainType string) string {
	return fmt.Sprintf(CheckAndRemoveDuplicateVinsRows, chainType, chainType)
}

func CreateCheckAndRemoveDuplicateVoutsRowsQuery(chainType string) string {
	return fmt.Sprintf(CheckAndRemoveDuplicateVoutsRows, chainType, chainType)
}
