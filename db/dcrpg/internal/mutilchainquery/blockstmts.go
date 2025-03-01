package mutilchainquery

import (
	"fmt"

	"github.com/decred/dcrdata/v8/db/dbtypes"
)

const (
	// Block insert
	insertBlockRow0 = `INSERT INTO %sblocks (
		hash, height, size, is_valid, version, merkle_root, stake_root,
		numtx, num_rtx, tx, txDbIDs, num_stx, stx, stxDbIDs,
		time, nonce, vote_bits, final_state, voters,
		fresh_stake, revocations, pool_size, bits, sbits, 
		difficulty, extra_data, stake_version, previous_hash, num_vins, num_vouts, fees, total_sent)
	VALUES ($1, $2, $3, $4, $5, $6, $7,
		$8, $9, %s, %s, $10, %s, %s,
		$11, $12, $13, $14, $15, 
		$16, $17, $18, $19, $20,
		$21, $22, $23, $24, $25, $26, $27, $28) `
	insertBlockRow         = insertBlockRow0 + `RETURNING id;`
	insertBlockRowChecked  = insertBlockRow0 + `ON CONFLICT (hash) DO NOTHING RETURNING id;`
	insertBlockRowReturnId = `WITH ins AS (` +
		insertBlockRow0 +
		`ON CONFLICT (hash) DO UPDATE
		SET hash = NULL WHERE FALSE
		RETURNING id
		)
	SELECT id FROM ins
	UNION  ALL
	SELECT id FROM %sblocks
	WHERE  hash = $1
	LIMIT  1;`

	UpdateLastBlockValid = `UPDATE %sblocks SET is_valid = $2 WHERE id = $1;`

	CreateBlockTable = `CREATE TABLE IF NOT EXISTS %sblocks (  
		id SERIAL PRIMARY KEY,
		hash TEXT NOT NULL, -- UNIQUE
		height INT4,
		size INT4,
		is_valid BOOLEAN,
		version INT4,
		merkle_root TEXT,
		stake_root TEXT,
		numtx INT4,
		num_rtx INT4,
		tx TEXT[],
		txDbIDs INT8[],
		num_stx INT4,
		stx TEXT[],
		stxDbIDs INT8[],
		time INT8,
		nonce INT8,
		vote_bits INT2,
		final_state BYTEA,
		voters INT2,
		fresh_stake INT2,
		revocations INT2,
		pool_size INT4,
		bits INT4,
		sbits INT8,
		difficulty FLOAT8,
		extra_data BYTEA,
		stake_version INT4,
		previous_hash TEXT,
		num_vins INT4,
		num_vouts INT4,
		fees INT8,
		total_sent INT8,
		CONSTRAINT ux_%sblock_hash UNIQUE (hash)
	);`

	InsertBlockSimpleInfo = `INSERT INTO %sblocks (hash, height, time) VALUES ($1, $2, $3) RETURNING id;`

	IndexBlockTableOnHash = `CREATE UNIQUE INDEX uix_%sblock_hash
		ON %sblocks(hash);`
	DeindexBlockTableOnHash = `DROP INDEX uix_%sblock_hash;`

	// IndexBlocksTableOnHeight creates the index uix_block_height on (height).
	// This is not unique because of side chains.
	IndexBlocksTableOnHeight   = `CREATE INDEX uix_%sblock_height ON %sblocks(height);`
	DeindexBlocksTableOnHeight = `DROP INDEX uix_%sblock_height CASCADE;`

	// IndexBlocksTableOnHeight creates the index uix_block_time on (time).
	// This is not unique because of side chains.
	IndexBlocksTableOnTime   = `CREATE INDEX uix_%sblock_time ON %sblocks("time");`
	DeindexBlocksTableOnTime = `DROP INDEX uix_%sblock_time CASCADE;`

	RetrieveBestBlock       = `SELECT * FROM %sblocks ORDER BY height DESC LIMIT 0, 1;`
	RetrieveBestBlockHeight = `SELECT id, hash, height FROM %sblocks ORDER BY height DESC LIMIT 1;`
	RetrieveBlockInfoData   = `SELECT time,height,total_sent,fees,numtx,num_vins,num_vouts FROM %sblocks WHERE height >= $1 AND height <= $2 ORDER BY height DESC;`
	RetrieveBlockDetail     = `SELECT time,height,total_sent,fees,numtx,num_vins,num_vouts FROM %sblocks WHERE height = $1;`
	// block_chain, with primary key that is not a SERIAL
	CreateBlockPrevNextTable = `CREATE TABLE IF NOT EXISTS %sblock_chain (
		block_db_id INT8 PRIMARY KEY,
		prev_hash TEXT NOT NULL,
		this_hash TEXT UNIQUE NOT NULL, -- UNIQUE
		next_hash TEXT
	);`

	// Insert includes the primary key, which should be from the blocks table
	InsertBlockPrevNext = `INSERT INTO %sblock_chain (
		block_db_id, prev_hash, this_hash, next_hash)
	VALUES ($1, $2, $3, $4)
	ON CONFLICT (this_hash) DO NOTHING;`

	UpdateBlockNext = `UPDATE %sblock_chain set next_hash = $2 WHERE block_db_id = $1;`

	SelectDiffByTime = `SELECT difficulty
		FROM %sblocks
		WHERE time >= $1
		ORDER BY time
		LIMIT 1;`

	SelectBlockStats = `SELECT height, size, time, numtx, difficulty
		FROM %sblocks
		WHERE height > $1
		ORDER BY height;`

	CheckExistBLock         = `SELECT EXISTS(SELECT 1 FROM %sblocks WHERE height = $1);`
	SelectBlockHeightByHash = `SELECT height FROM %sblocks WHERE hash = $1;`
	SelectBlockHashByHeight = `SELECT hash FROM %sblocks WHERE height = $1;`
	DeleteOlderThan20Blocks = `DELETE FROM %sblocks WHERE height < $1;`
	SelectMinBlockHeight    = `SELECT min(height) FROM %sblocks;`
)

func MakeSelectBlockStats(chainType string) string {
	return fmt.Sprintf(SelectBlockStats, chainType)
}

func MakeSelectMinBlockHeight(chainType string) string {
	return fmt.Sprintf(SelectMinBlockHeight, chainType)
}

func MakeInsertSimpleBlockInfo(chainType string) string {
	return fmt.Sprintf(InsertBlockSimpleInfo, chainType)
}

func MakeRetrieveBlockInfoData(chainType string) string {
	return fmt.Sprintf(RetrieveBlockInfoData, chainType)
}

func MakeRetrieveBlockDetail(chainType string) string {
	return fmt.Sprintf(RetrieveBlockDetail, chainType)
}

func MakeCheckExistBLock(chainType string) string {
	return fmt.Sprintf(CheckExistBLock, chainType)
}

func MakeDeleteOlderThan20Blocks(chainType string) string {
	return fmt.Sprintf(DeleteOlderThan20Blocks, chainType)
}

func MakeSelectBlockHeightByHash(chainType string) string {
	return fmt.Sprintf(SelectBlockHeightByHash, chainType)
}

func MakeSelectBlockHashByHeight(chainType string) string {
	return fmt.Sprintf(SelectBlockHashByHeight, chainType)
}

func MakeSelectDiffByTime(chainType string) string {
	return fmt.Sprintf(SelectDiffByTime, chainType)
}

func MakeIndexBlockTableOnHash(chainType string) string {
	return fmt.Sprintf(IndexBlockTableOnHash, chainType, chainType)
}

func MakeDeindexBlockTableOnHash(chainType string) string {
	return fmt.Sprintf(DeindexBlockTableOnHash, chainType)
}

func MakeIndexBlocksTableOnHeight(chainType string) string {
	return fmt.Sprintf(IndexBlocksTableOnHeight, chainType, chainType)
}

func MakeDeindexBlocksTableOnHeight(chainType string) string {
	return fmt.Sprintf(DeindexBlocksTableOnHeight, chainType)
}

func MakeIndexBlocksTableOnTime(chainType string) string {
	return fmt.Sprintf(IndexBlocksTableOnTime, chainType, chainType)
}

func MakeDeindexBlocksTableOnTime(chainType string) string {
	return fmt.Sprintf(DeindexBlocksTableOnTime, chainType)
}

func MakeBlockInsertStatement(block *dbtypes.Block, checked bool, chainType string) string {
	return makeBlockInsertStatement(block.TxDbIDs, block.STxDbIDs,
		block.Tx, block.STx, checked, chainType)
}

func makeBlockInsertStatement(txDbIDs, stxDbIDs []uint64, rtxs, stxs []string, checked bool, chainType string) string {
	rtxDbIDsARRAY := makeARRAYOfBIGINTs(txDbIDs)
	stxDbIDsARRAY := makeARRAYOfBIGINTs(stxDbIDs)
	rtxTEXTARRAY := makeARRAYOfTEXT(rtxs)
	stxTEXTARRAY := makeARRAYOfTEXT(stxs)
	var insert string
	if checked {
		insert = insertBlockRowChecked
	} else {
		insert = insertBlockRow
	}
	return fmt.Sprintf(insert, chainType, rtxTEXTARRAY, rtxDbIDsARRAY,
		stxTEXTARRAY, stxDbIDsARRAY)
}

func CreateBlockTableFunc(chainType string) string {
	return fmt.Sprintf(CreateBlockTable, chainType, chainType)
}

func CreateBlockPrevNextTableFunc(chainType string) string {
	return fmt.Sprintf(CreateBlockPrevNextTable, chainType)
}

func RetrieveBestBlockHeightStatement(chainType string) string {
	return fmt.Sprintf(RetrieveBestBlockHeight, chainType)
}

func InsertBlockPrevNextStatement(chainType string) string {
	return fmt.Sprintf(InsertBlockPrevNext, chainType)
}

func UpdateLastBlockValidStatement(chainType string) string {
	return fmt.Sprintf(UpdateLastBlockValid, chainType)
}

func UpdateBlockNextStatement(chainType string) string {
	return fmt.Sprintf(UpdateBlockNext, chainType)
}
