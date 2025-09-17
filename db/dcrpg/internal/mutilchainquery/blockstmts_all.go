package mutilchainquery

import (
	"fmt"

	"github.com/decred/dcrdata/v8/mutilchain"
)

const (
	// Block insert
	insertBlockAllRow0 = `INSERT INTO %sblocks_all (
		hash, height, size, is_valid, version,
		numtx, time, nonce, pool_size, bits, 
		difficulty, previous_hash, num_vins, num_vouts, fees, total_sent)
	VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`
	insertXmrBlockAllRow0 = `INSERT INTO xmrblocks_all (
		hash, height, block_blob, size, is_valid, version,
		numtx, time, nonce, pool_size, bits, 
		difficulty, difficulty_num, cumulative_difficulty, pow_algo, previous_hash, num_vins, num_vouts, fees, total_sent, reward)
	VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)`

	insertBlockAllRow           = insertBlockAllRow0 + ` RETURNING id;`
	insertBlockAllRowChecked    = insertBlockAllRow0 + ` ON CONFLICT (hash) DO NOTHING RETURNING id;`
	insertXmrBlockAllRow        = insertXmrBlockAllRow0 + ` RETURNING id;`
	insertXmrBlockAllRowChecked = insertXmrBlockAllRow0 + ` ON CONFLICT (hash) DO NOTHING RETURNING id;`
	insertBlockAllRowReturnId   = `WITH ins AS (` +
		insertBlockAllRow0 +
		`ON CONFLICT (hash) DO UPDATE
		SET hash = NULL WHERE FALSE
		RETURNING id
		)
	SELECT id FROM ins
	UNION  ALL
	SELECT id FROM %sblocks_all
	WHERE  hash = $1
	LIMIT  1;`

	UpdateLastBlockAllValid = `UPDATE %sblocks_all SET is_valid = $2 WHERE id = $1;`

	CreateBlockAllTable = `CREATE TABLE IF NOT EXISTS %sblocks_all (  
		id SERIAL PRIMARY KEY,
		hash TEXT NOT NULL, -- UNIQUE
		height INT4,
		block_blob BYTEA,
		size INT4,
		is_valid BOOLEAN,
		version INT4,
		numtx INT4,
		time INT8,
		nonce INT8,
		pool_size INT4,
		bits INT4,
		difficulty FLOAT8,
		difficulty_num NUMERIC(40,0), -- For monero
		cumulative_difficulty NUMERIC(40,0),
		pow_algo TEXT,
		previous_hash TEXT,
		num_vins INT4,
		num_vouts INT4,
		fees INT8,
		total_sent INT8,
		reward INT8,
		address_updated BOOLEAN DEFAULT FALSE,
		synced BOOLEAN DEFAULT FALSE
	);`

	// SelectBlocksAllWithTimeRange = `SELECT height FROM %sblocks_all WHERE time >= $1 AND time <= $2`

	SelectBlocksAllUnsynchoronized = `SELECT height FROM %sblocks_all WHERE synced IS NOT TRUE ORDER BY height`

	UpdateBlockAllSynced = `UPDATE %sblocks_all SET synced = true WHERE height = $1 RETURNING id`

	SelectRemainingNotSyncedHeights = `WITH all_heights AS (SELECT generate_series(0, $1) AS height),
existing_heights AS (
  SELECT DISTINCT height FROM %sblocks_all WHERE synced = true
)
SELECT a.height
FROM all_heights a
LEFT JOIN existing_heights e ON a.height = e.height
WHERE e.height IS NULL
ORDER BY a.height ASC;`

	// insertBlockAllSimpleInfo = `INSERT INTO %sblocks_all(hash, height, time, synced) VALUES ($1, $2, $3, $4) `

	// InsertBlockAllSimpleInfo = insertBlockAllSimpleInfo + `RETURNING id;`

	// UpsertBlockAllSimpleInfo = insertBlockAllSimpleInfo + `ON CONFLICT (hash) DO UPDATE
	// 	SET synced = $4 RETURNING id;`

	IndexBlockAllTableOnHash = `CREATE UNIQUE INDEX uix_%sblock_all_hash
		ON %sblocks_all(hash);`
	DeindexBlockAllTableOnHash = `DROP INDEX uix_%sblock_all_hash;`

	// IndexBlocksTableOnHeight creates the index uix_block_height on (height).
	// This is not unique because of side chains.
	IndexBlocksAllTableOnHeight   = `CREATE INDEX uix_%sblock_all_height ON %sblocks_all(height);`
	DeindexBlocksAllTableOnHeight = `DROP INDEX uix_%sblock_all_height CASCADE;`

	// IndexBlocksTableOnHeight creates the index uix_block_time on (time).
	// This is not unique because of side chains.
	IndexBlocksAllTableOnTime   = `CREATE INDEX uix_%sblock_all_time ON %sblocks_all("time");`
	DeindexBlocksAllTableOnTime = `DROP INDEX uix_%sblock_all_time CASCADE;`

	RetrieveBestBlockAll       = `SELECT * FROM %sblocks_all ORDER BY height DESC LIMIT 0, 1;`
	RetrieveBestBlockAllHeight = `SELECT id, hash, height FROM %sblocks_all ORDER BY height DESC LIMIT 1;`
	RetrieveBlockAllInfoData   = `SELECT time,height,total_sent,fees,numtx,num_vins,num_vouts FROM %sblocks_all WHERE height >= $1 AND height <= $2 ORDER BY height DESC;`
	RetrieveBlockAllDetail     = `SELECT time,height,total_sent,fees,numtx,num_vins,num_vouts FROM %sblocks_all WHERE height = $1;`
	SelectBlockAllDiffByTime   = `SELECT difficulty
		FROM %sblocks_all
		WHERE time >= $1
		ORDER BY time
		LIMIT 1;`

	SelectBlockAllStats = `SELECT height, size, time, numtx, difficulty
		FROM %sblocks_all
		WHERE height > $1
		ORDER BY height;`

	SelectXmrBlockAllStats = `SELECT height, size, time, numtx, difficulty, fees, reward
		FROM xmrblocks_all
		WHERE height > $1
		ORDER BY height;`

	CheckExistBLockAll         = `SELECT EXISTS(SELECT 1 FROM %sblocks_all WHERE height = $1);`
	SelectBlockAllHeightByHash = `SELECT height FROM %sblocks_all WHERE hash = $1 LIMIT 1;`
	SelectBlockAllHashByHeight = `SELECT hash FROM %sblocks_all WHERE height = $1;`
	SelectMinBlockAllHeight    = `SELECT min(height) FROM %sblocks_all;`
	DeleteBlocksWithMinHeight  = `DELETE FROM %sblocks_all WHERE height > $1`
)

func MakeSelectBlockAllStats(chainType string) string {
	return fmt.Sprintf(SelectBlockAllStats, chainType)
}

func MakeSelectBlocksAllUnsynchoronized(chainType string) string {
	return fmt.Sprintf(SelectBlocksAllUnsynchoronized, chainType)
}

// func MakeSelectBlocksAllWithTimeRange(chainType string) string {
// 	return fmt.Sprintf(SelectBlocksAllWithTimeRange, chainType)
// }

func MakeUpdateBlockAllSynced(chainType string) string {
	return fmt.Sprintf(UpdateBlockAllSynced, chainType)
}

// func MakeUpsertBlockAllSimpleInfo(chainType string) string {
// 	return fmt.Sprintf(UpsertBlockAllSimpleInfo, chainType)
// }

func MakeSelectMinBlockAllHeight(chainType string) string {
	return fmt.Sprintf(SelectMinBlockAllHeight, chainType)
}

// func MakeInsertSimpleBlockAllInfo(chainType string) string {
// 	return fmt.Sprintf(InsertBlockAllSimpleInfo, chainType)
// }

func MakeRetrieveBlockAllInfoData(chainType string) string {
	return fmt.Sprintf(RetrieveBlockAllInfoData, chainType)
}

func MakeRetrieveBlockAllDetail(chainType string) string {
	return fmt.Sprintf(RetrieveBlockAllDetail, chainType)
}

func MakeCheckExistBLockAll(chainType string) string {
	return fmt.Sprintf(CheckExistBLockAll, chainType)
}

func MakeSelectBlockAllHeightByHash(chainType string) string {
	return fmt.Sprintf(SelectBlockAllHeightByHash, chainType)
}

func MakeSelectBlockAllHashByHeight(chainType string) string {
	return fmt.Sprintf(SelectBlockAllHashByHeight, chainType)
}

func MakeSelectBlockAllDiffByTime(chainType string) string {
	return fmt.Sprintf(SelectBlockAllDiffByTime, chainType)
}

func MakeIndexBlockAllTableOnHash(chainType string) string {
	return fmt.Sprintf(IndexBlockAllTableOnHash, chainType, chainType)
}

func MakeDeindexBlockAllTableOnHash(chainType string) string {
	return fmt.Sprintf(DeindexBlockAllTableOnHash, chainType)
}

func MakeIndexBlocksAllTableOnHeight(chainType string) string {
	return fmt.Sprintf(IndexBlocksAllTableOnHeight, chainType, chainType)
}

func MakeDeindexBlocksAllTableOnHeight(chainType string) string {
	return fmt.Sprintf(DeindexBlocksAllTableOnHeight, chainType)
}

func MakeIndexBlocksAllTableOnTime(chainType string) string {
	return fmt.Sprintf(IndexBlocksAllTableOnTime, chainType, chainType)
}

func MakeDeindexBlocksAllTableOnTime(chainType string) string {
	return fmt.Sprintf(DeindexBlocksAllTableOnTime, chainType)
}

func MakeBlockAllInsertStatement(checked bool, chainType string) string {
	return makeBlockAllInsertStatement(checked, chainType)
}

func makeBlockAllInsertStatement(checked bool, chainType string) string {
	if checked {
		if chainType == mutilchain.TYPEXMR {
			return insertXmrBlockAllRowChecked
		} else {
			return fmt.Sprintf(insertBlockAllRowChecked, chainType)
		}
	} else {
		if chainType == mutilchain.TYPEXMR {
			return insertXmrBlockAllRow
		} else {
			return fmt.Sprintf(insertBlockAllRow, chainType)
		}
	}
}

func CreateBlockAllTableFunc(chainType string) string {
	return fmt.Sprintf(CreateBlockAllTable, chainType)
}

func RetrieveBestBlockAllHeightStatement(chainType string) string {
	return fmt.Sprintf(RetrieveBestBlockAllHeight, chainType)
}

func UpdateLastBlockAllValidStatement(chainType string) string {
	return fmt.Sprintf(UpdateLastBlockAllValid, chainType)
}

func CreateSelectRemainingNotSyncedHeights(chainType string) string {
	return fmt.Sprintf(SelectRemainingNotSyncedHeights, chainType)
}

func CreateDeleteBlocksWithMinHeightQuery(chainType string) string {
	return fmt.Sprintf(DeleteBlocksWithMinHeight, chainType)
}
