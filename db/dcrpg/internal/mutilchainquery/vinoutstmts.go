package mutilchainquery

import (
	"encoding/hex"
	"fmt"
	"strings"

	"github.com/decred/dcrdata/v8/db/dbtypes"
)

const (
	// vins

	CreateVinTable = `CREATE TABLE IF NOT EXISTS %svins (
		id SERIAL8 PRIMARY KEY,
		tx_hash TEXT,
		tx_index INT4,
		tx_tree INT2,
		prev_tx_hash TEXT,
		prev_tx_index INT8,
		prev_tx_tree INT2,
		value_in INT8,
		CONSTRAINT ux_%svin_txhash_txindex UNIQUE (tx_hash,tx_index)
	);`

	InsertVinRow0 = `INSERT INTO %svins (tx_hash, tx_index, tx_tree, prev_tx_hash, prev_tx_index, prev_tx_tree, value_in)
		VALUES ($1, $2, $3, $4, $5, $6, $7) `
	InsertVinRow        = InsertVinRow0 + `RETURNING id;`
	InsertVinRowChecked = InsertVinRow0 +
		`ON CONFLICT (tx_hash, tx_index) DO NOTHING RETURNING id;`

	IndexVinTableOnVins = `CREATE INDEX uix_%svin
		ON %svins(tx_hash, tx_index)
		;` // STORING (prev_tx_hash, prev_tx_index)
	IndexVinTableOnPrevOuts = `CREATE INDEX uix_%svin_prevout
		ON %svins(prev_tx_hash, prev_tx_index)
		;` // STORING (tx_hash, tx_index)
	DeindexVinTableOnVins     = `DROP INDEX uix_%svin;`
	DeindexVinTableOnPrevOuts = `DROP INDEX uix_%svin_prevout;`

	SelectVinIDsALL = `SELECT id FROM %svins;`
	CountRow        = `SELECT reltuples::BIGINT AS estimate FROM pg_class WHERE relname='%svins';`

	SelectSpendingTxsByPrevTx = `SELECT id, tx_hash, tx_index, prev_tx_index FROM %svins WHERE prev_tx_hash=$1;`
	SelectSpendingTxByPrevOut = `SELECT id, tx_hash, tx_index FROM %svins 
		WHERE prev_tx_hash=$1 AND prev_tx_index=$2;`
	SelectFundingTxsByTx        = `SELECT id, prev_tx_hash FROM %svins WHERE tx_hash=$1;`
	SelectFundingTxByTxIn       = `SELECT id, prev_tx_hash FROM %svins WHERE tx_hash=$1 AND tx_index=$2;`
	SelectFundingOutpointByTxIn = `SELECT id, prev_tx_hash, prev_tx_index, prev_tx_tree FROM %svins 
		WHERE tx_hash=$1 AND tx_index=$2;`
	SelectFundingOutpointByVinID     = `SELECT prev_tx_hash, prev_tx_index, prev_tx_tree FROM %svins WHERE id=$1;`
	SelectSpendingTxByVinID          = `SELECT tx_hash, tx_index, tx_tree FROM %svins WHERE id=$1;`
	SelectAllVinInfoByID             = `SELECT * FROM %svins WHERE id=$1;`
	SelectFundingOutpointIndxByVinID = `SELECT prev_tx_index FROM %svins WHERE id=$1;`

	SelectPkScriptByVinID = `SELECT version, pkscript FROM %svouts
		JOIN %svins ON %svouts.tx_hash=%svins.prev_tx_hash and %svouts.tx_index=%svins.prev_tx_index
		WHERE %svins.id=$1;`

	CreateVinType = `CREATE TYPE %svin_t AS (
		prev_tx_hash TEXT,
		prev_tx_index INTEGER,
		prev_tx_tree SMALLINT,
		htlc_seq_VAL INTEGER,
		value_in DOUBLE PRECISION,
		script_hex BYTEA
	);`

	// vouts

	CreateVoutTable = `CREATE TABLE IF NOT EXISTS %svouts (
		id SERIAL8 PRIMARY KEY,
		tx_hash TEXT,
		tx_index INT4,
		tx_tree INT2,
		value INT8,
		version INT2,
		pkscript BYTEA,
		script_req_sigs INT4,
		script_type TEXT,
		script_addresses TEXT[],
		CONSTRAINT ux_%svout_txhash_txindex UNIQUE (tx_hash,tx_index)
	);`

	insertVoutRow0 = `INSERT INTO %svouts (tx_hash, tx_index, tx_tree, value, 
		version, pkscript, script_req_sigs, script_type, script_addresses)
	VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) `
	insertVoutRow         = insertVoutRow0 + `RETURNING id;`
	insertVoutRowChecked  = insertVoutRow0 + `ON CONFLICT (tx_hash, tx_index) DO NOTHING RETURNING id;`
	insertVoutRowReturnId = `WITH inserting AS (` +
		insertVoutRow0 +
		`ON CONFLICT (tx_hash, tx_index, tx_tree) DO UPDATE
		SET tx_hash = NULL WHERE FALSE
		RETURNING id
		)
	 SELECT id FROM inserting
	 UNION  ALL
	 SELECT id FROM %svouts
	 WHERE  tx_hash = $1 AND tx_index = $2 AND tx_tree = $3
	 LIMIT  1;`
	CountTotalVouts        = `SELECT count(*) FROM %svouts;`
	SelectPkScriptByID     = `SELECT pkscript FROM %svouts WHERE id=$1;`
	SelectVoutIDByOutpoint = `SELECT id FROM %svouts WHERE tx_hash=$1 and tx_index=$2;`
	SelectVoutByID         = `SELECT * FROM %svouts WHERE id=$1;`

	RetrieveVoutValue  = `SELECT value FROM %svouts WHERE tx_hash=$1 and tx_index=$2;`
	RetrieveVoutValues = `SELECT value, tx_index, tx_tree FROM %svouts WHERE tx_hash=$1;`

	IndexVoutTableOnTxHashIdx = `CREATE INDEX uix_%svout_txhash_ind
		ON %svouts(tx_hash, tx_index);`
	DeindexVoutTableOnTxHashIdx = `DROP INDEX uix_%svout_txhash_ind;`

	IndexVoutTableOnTxHash = `CREATE INDEX uix_%svout_txhash
		ON %svouts(tx_hash);`
	DeindexVoutTableOnTxHash = `DROP INDEX uix_%svout_txhash;`

	CreateVoutType = `CREATE TYPE %svout_t AS (
		value INT8,
		version INT2,
		pkscript BYTEA,
		script_req_sigs INT4,
		script_type TEXT,
		script_addresses TEXT[]
	);`

	SelectCoinSupply = `SELECT {chaintype}transactions.block_time, sum({chaintype}vins.value_in)
	FROM {chaintype}vins JOIN {chaintype}transactions
	ON {chaintype}vins.tx_hash = {chaintype}transactions.tx_hash
	WHERE NOT EXISTS(SELECT 1 FROM {chaintype}vins WHERE tx_hash = {chaintype}vins.prev_tx_hash)
	AND {chaintype}transactions.block_height > $1
	GROUP BY {chaintype}transactions.block_time, {chaintype}transactions.block_height
	ORDER BY {chaintype}transactions.block_time;`
)

func MakeSelectCoinSupply(chainType string) string {
	return strings.ReplaceAll(SelectCoinSupply, "{chaintype}", chainType)
}

func MakeCountTotalVouts(chainType string) string {
	return fmt.Sprintf(CountTotalVouts, chainType)
}

func MakeSelectFundingOutpointIndxByVinID(chainType string) string {
	return fmt.Sprintf(SelectFundingOutpointIndxByVinID, chainType)
}

func MakeSelectSpendingTxsByPrevTx(chainType string) string {
	return fmt.Sprintf(SelectSpendingTxsByPrevTx, chainType)
}

func MakeSelectPkScriptByVinID(chainType string) string {
	return fmt.Sprintf(SelectPkScriptByVinID, chainType, chainType, chainType, chainType, chainType, chainType, chainType)
}

func MakeSelectSpendingTxByPrevOut(chainType string) string {
	return fmt.Sprintf(SelectSpendingTxByPrevOut, chainType)
}

func MakeSelectVoutByID(chainType string) string {
	return fmt.Sprintf(SelectVoutByID, chainType)
}

func MakeVoutInsertStatement(checked bool, chainType string) string {
	if checked {
		return fmt.Sprintf(insertVoutRowChecked, chainType)
	}
	return fmt.Sprintf(insertVoutRow, chainType)
}

func makeARRAYOfVouts(vouts []*dbtypes.Vout) string {
	var rowSubStmts []string
	for i := range vouts {
		hexPkScript := hex.EncodeToString(vouts[i].ScriptPubKey)
		rowSubStmts = append(rowSubStmts,
			fmt.Sprintf(`ROW(%d, %d, decode('%s','hex'), %d, '%s', %s)`,
				vouts[i].Value, vouts[i].Version, hexPkScript,
				vouts[i].ScriptPubKeyData.ReqSigs, vouts[i].ScriptPubKeyData.Type,
				makeARRAYOfTEXT(vouts[i].ScriptPubKeyData.Addresses)))
	}

	return makeARRAYOfUnquotedTEXT(rowSubStmts) + "::vout_t[]"
}

func CreateVinTableFunc(chainType string) string {
	return fmt.Sprintf(CreateVinTable, chainType, chainType)
}

func CreateVoutTableFunc(chainType string) string {
	return fmt.Sprintf(CreateVoutTable, chainType, chainType)
}

func CreateVinTypeFunc(chainType string) string {
	return fmt.Sprintf(CreateVinType, chainType)
}

func CreateVoutTypeFunc(chainType string) string {
	return fmt.Sprintf(CreateVoutType, chainType)
}

func InsertVinRowFunc(chainType string) string {
	return fmt.Sprintf(InsertVinRow, chainType)
}

func InsertVinRowFuncCheck(checked bool, chainType string) string {
	if checked {
		return fmt.Sprintf(InsertVinRowChecked, chainType)
	}
	return fmt.Sprintf(InsertVinRow, chainType)
}

func SelectVinIDsALLFunc(chainType string) string {
	return fmt.Sprintf(SelectVinIDsALL, chainType)
}

func SelectAllVinInfoByIDFunc(chainType string) string {
	return fmt.Sprintf(SelectAllVinInfoByID, chainType)
}

func MakeIndexVinTableOnVins(chainType string) string {
	return fmt.Sprintf(IndexVinTableOnVins, chainType, chainType)
}

func MakeDeindexVinTableOnVins(chainType string) string {
	return fmt.Sprintf(DeindexVinTableOnVins, chainType)
}

func MakeIndexVinTableOnPrevOuts(chainType string) string {
	return fmt.Sprintf(IndexVinTableOnPrevOuts, chainType, chainType)
}

func MakeDeindexVinTableOnPrevOuts(chainType string) string {
	return fmt.Sprintf(DeindexVinTableOnPrevOuts, chainType)
}

func MakeIndexVoutTableOnTxHashIdx(chainType string) string {
	return fmt.Sprintf(IndexVoutTableOnTxHashIdx, chainType, chainType)
}

func MakeDeindexVoutTableOnTxHashIdx(chainType string) string {
	return fmt.Sprintf(DeindexVoutTableOnTxHashIdx, chainType)
}

func MakeIndexVoutTableOnTxHash(chainType string) string {
	return fmt.Sprintf(IndexVoutTableOnTxHash, chainType, chainType)
}

func MakeDeindexVoutTableOnTxHash(chainType string) string {
	return fmt.Sprintf(DeindexVoutTableOnTxHash, chainType)
}
