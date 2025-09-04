package mutilchainquery

import "fmt"

const (
	// Insert
	insertTxRow0 = `INSERT INTO %stransactions (
		block_hash, block_height, block_time, time,
		tx_type, version, tree, tx_hash, block_index, 
		lock_time, expiry, size, spent, sent, fees, 
		num_vin, vins, vin_db_ids,
		num_vout, vouts, vout_db_ids)
	VALUES (
		$1, $2, $3, $4, 
		$5, $6, $7, $8, $9,
		$10, $11, $12, $13, $14, $15,
		$16, $17, $18,
		$19, $20, $21) `
	insertTxRow        = insertTxRow0 + `RETURNING id;`
	insertTxRowChecked = insertTxRow0 + `ON CONFLICT (tx_hash, block_hash) DO NOTHING RETURNING id;`
	upsertTxRow        = insertTxRow0 + `ON CONFLICT (tx_hash, block_hash) DO UPDATE 
		SET block_hash = $1, block_index = $2, tree = $3 RETURNING id;`
	insertTxRowReturnId = `WITH ins AS (` +
		insertTxRow0 +
		`ON CONFLICT (tx_hash, block_hash) DO UPDATE
		SET tx_hash = NULL WHERE FALSE
		RETURNING id
		)
	SELECT id FROM ins
	UNION  ALL
	SELECT id FROM %sblocks
	WHERE  tx_hash = $3 AND block_hash = $1
	LIMIT  1;`

	CreateTransactionTable = `CREATE TABLE IF NOT EXISTS %stransactions (
		id SERIAL8 PRIMARY KEY,
		/*block_db_id INT4,*/
		block_hash TEXT,
		block_height INT8,
		block_time INT8,
		time INT8,
		tx_type INT4,
		version INT4,
		tree INT2,
		tx_hash TEXT,
		tx_blob BYTEA,
		tx_extra JSONB,
		block_index INT4,
		is_ringct BOOLEAN DEFAULT FALSE,
		rct_type INT,
		tx_public_key TEXT,
		prunable_size INT,
		lock_time INT4,
		expiry INT4,
		size INT4,
		spent INT8,
		sent INT8,
		fees INT8,
		num_vin INT4,
		vins TEXT,
		vin_db_ids INT8[],
		num_vout INT4,
		vouts %svout_t[],
		vout_db_ids INT8[],
		CONSTRAINT ux_%stransaction_txhash_blockhash UNIQUE (block_hash, tx_hash)
	);`
	SelectTotalTransaction = `SELECT count(*) FROM %stransactions;`
	SelectTxByHash         = `SELECT id, block_hash, block_index, tree FROM %stransactions WHERE tx_hash = $1;`
	SelectTxsByBlockHash   = `SELECT id, tx_hash, block_index, tree FROM %stransactions WHERE block_hash = $1;`

	SelectFullTxByHash = `SELECT id, block_hash, block_height, block_time, 
		time, tx_type, version, tree, tx_hash, block_index, lock_time, expiry, 
		size, spent, sent, fees, num_vin, vin_db_ids, num_vout, vout_db_ids 
		FROM %stransactions WHERE tx_hash = $1;`

	SelectRegularTxByHash = `SELECT id, block_hash, block_index FROM %stransactions WHERE tx_hash = $1 and tree=0;`
	SelectStakeTxByHash   = `SELECT id, block_hash, block_index FROM %stransactions WHERE tx_hash = $1 and tree=1;`

	SelectTxsBlocks = `SELECT block_height, block_hash, block_index
		FROM %stransactions
		WHERE tx_hash = $1 ORDER BY block_height DESC;`

	IndexTransactionTableOnBlockIn = `CREATE UNIQUE INDEX uix_%stx_block_in
		ON %stransactions(block_hash, block_index)
		;` // STORING (tx_hash, block_hash)
	DeindexTransactionTableOnBlockIn = `DROP INDEX uix_%stx_block_in;`

	IndexTransactionTableOnHashes = `CREATE UNIQUE INDEX uix_%stx_hashes
		 ON %stransactions(tx_hash, block_hash)
		 ;` // STORING (block_hash, block_index, tree)
	DeindexTransactionTableOnHashes = `DROP INDEX uix_%stx_hashes;`

	IndexTransactionTableOnBlockHeight   = `CREATE INDEX ix_%stx_block_height ON %stransactions(block_height);`
	DeindexTransactionTableOnBlockHeight = `DROP INDEX ix_%stx_block_height CASCADE;`

	//SelectTxByPrevOut = `SELECT * FROM transactions WHERE vins @> json_build_array(json_build_object('prevtxhash',$1)::jsonb)::jsonb;`
	//SelectTxByPrevOut = `SELECT * FROM transactions WHERE vins #>> '{"prevtxhash"}' = '$1';`

	//SelectTxsByPrevOutTx = `SELECT * FROM transactions WHERE vins @> json_build_array(json_build_object('prevtxhash',$1::TEXT)::jsonb)::jsonb;`
	// '[{"prevtxhash":$1}]'

	// RetrieveVoutValues = `WITH voutsOnly AS (
	// 		SELECT unnest((vouts)) FROM transactions WHERE id = $1
	// 	) SELECT v.* FROM voutsOnly v;`
	// RetrieveVoutValues = `SELECT vo.value
	// 	FROM  transactions txs, unnest(txs.vouts) vo
	// 	WHERE txs.id = $1;`
	// RetrieveVoutValue = `SELECT vouts[$2].value FROM transactions WHERE id = $1;`

	RetrieveVoutDbIDs             = `SELECT unnest(vout_db_ids) FROM %stransactions WHERE id = $1;`
	RetrieveVoutDbID              = `SELECT vout_db_ids[$2] FROM %stransactions WHERE id = $1;`
	SelectFeesPerBlockAboveHeight = `
	SELECT block_height, SUM(fees) AS fees
	FROM %stransactions
	WHERE block_height > $1
	GROUP BY block_height
	ORDER BY block_height;`
	DeleteTxsOfOlderThan20Blocks = `DELETE FROM %stransactions WHERE block_height < $1;`
)

func MakeSelectFeesPerBlockAboveHeight(chainType string) string {
	return fmt.Sprintf(SelectFeesPerBlockAboveHeight, chainType)
}

func MakeDeleteTxsOfOlderThan20Blocks(chainType string) string {
	return fmt.Sprintf(DeleteTxsOfOlderThan20Blocks, chainType)
}

func MakeSelectTotalTransaction(chainType string) string {
	return fmt.Sprintf(SelectTotalTransaction, chainType)
}

func MakeSelectTxsBlocks(chainType string) string {
	return fmt.Sprintf(SelectTxsBlocks, chainType)
}

func MakeSelectFullTxByHash(chainType string) string {
	return fmt.Sprintf(SelectFullTxByHash, chainType)
}
func MakeIndexTransactionTableOnBlockIn(chainType string) string {
	return fmt.Sprintf(IndexTransactionTableOnBlockIn, chainType, chainType)
}

func MakeDeindexTransactionTableOnBlockIn(chainType string) string {
	return fmt.Sprintf(DeindexTransactionTableOnBlockIn, chainType)
}

func MakeIndexTransactionTableOnHashes(chainType string) string {
	return fmt.Sprintf(IndexTransactionTableOnHashes, chainType, chainType)
}

func MakeDeindexTransactionTableOnHashes(chainType string) string {
	return fmt.Sprintf(DeindexTransactionTableOnHashes, chainType)
}

func MakeIndexTransactionTableOnBlockHeight(chainType string) string {
	return fmt.Sprintf(IndexTransactionTableOnBlockHeight, chainType, chainType)
}

func MakeDeindexTransactionTableOnBlockHeight(chainType string) string {
	return fmt.Sprintf(DeindexTransactionTableOnBlockHeight, chainType)
}

// func makeTxInsertStatement(voutDbIDs, vinDbIDs []uint64, vouts []*dbtypes.Vout, checked bool) string {
// 	voutDbIDsBIGINT := makeARRAYOfBIGINTs(voutDbIDs)
// 	vinDbIDsBIGINT := makeARRAYOfBIGINTs(vinDbIDs)
// 	voutCompositeARRAY := makeARRAYOfVouts(vouts)
// 	var insert string
// 	if checked {
// 		insert = insertTxRowChecked
// 	} else {
// 		insert = insertTxRow
// 	}
// 	return fmt.Sprintf(insert, voutDbIDsBIGINT, voutCompositeARRAY, vinDbIDsBIGINT)
// }

func MakeTxInsertStatement(checked bool, chainType string) string {
	if checked {
		return fmt.Sprintf(insertTxRowChecked, chainType)
	}
	return fmt.Sprintf(insertTxRow, chainType)
}

func CreateTransactionTableFunc(chainType string) string {
	return fmt.Sprintf(CreateTransactionTable, chainType, chainType, chainType)
}
