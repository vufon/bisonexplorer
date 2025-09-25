package mutilchainquery

const (
	CreateMoneroOutputsTable = `CREATE TABLE IF NOT EXISTS monero_outputs (
  		id SERIAL8 PRIMARY KEY,
  		tx_hash TEXT NOT NULL,
  		tx_index INT4 NOT NULL,        -- output index within tx
  		global_index BIGINT,           -- global output index (if available from daemon)
  		out_pk TEXT,                   -- output public key (stealth public key)
  		amount_commitment BYTEA,       -- Pedersen commitment (binary)
  		amount_known BOOLEAN DEFAULT FALSE, -- true only if decoded via view key
  		amount INT8,                   -- decoded amount (valid only if amount_known = true)
  		spent BOOLEAN DEFAULT FALSE,   -- updated when key_image seen spent
  		created_at TIMESTAMPTZ DEFAULT now()
	);`

	InsertMoneroVoutsAllRow0 = `INSERT INTO monero_outputs (tx_hash, tx_index, global_index, out_pk, amount_commitment, amount_known, amount)
		VALUES ($1, $2, $3, $4, $5, $6, $7)`
	InsertMoneroVoutsAllRow  = InsertMoneroVoutsAllRow0 + ` RETURNING id;`
	InsertMoneroVoutsChecked = InsertMoneroVoutsAllRow0 +
		` ON CONFLICT (tx_hash, tx_index) DO NOTHING RETURNING id;`

	SelectTotalXmrOutputs = `SELECT COUNT(*) FROM monero_outputs;`

	IndexMoneroVoutsTableOnTxHashTxIndex   = `CREATE UNIQUE INDEX uix_monero_outputs_txhash_txindex ON monero_outputs(tx_hash, tx_index);`
	DeindexMoneroVoutsTableOnTxHashTxIndex = `DROP INDEX uix_monero_outputs_txhash_txindex;`

	IndexMoneroVoutTableOnGlobalIndex = `CREATE INDEX uix_monero_outputs_global_index
		ON monero_outputs(global_index);`
	DeindexMoneroVoutTableOnGlobalIndex = `DROP INDEX uix_monero_outputs_global_index;`

	IndexMoneroVoutTableOnOutPk = `CREATE INDEX uix_monero_outputs_out_pk
		ON monero_outputs(out_pk);`
	DeindexMoneroVoutTableOnOutPk = `DROP INDEX uix_monero_outputs_out_pk;`

	IndexMoneroVoutTableOnSpent = `CREATE INDEX uix_monero_outputs_spent
		ON monero_outputs(spent);`
	DeindexMoneroVoutTableOnSpent = `DROP INDEX uix_monero_outputs_spent;`

	DeleteMoneroOutputWithTxhashArray = `DELETE FROM monero_outputs WHERE tx_hash = ANY($1)`

	CheckAndRemoveDuplicateMoneroOutputsRows = `WITH duplicates AS (
  		SELECT id, row_number() OVER (PARTITION BY tx_hash, tx_index ORDER BY id) AS rn
  		FROM public.monero_outputs
  		WHERE tx_hash IS NOT NULL AND tx_index IS NOT NULL)
		DELETE FROM public.monero_outputs m
		USING duplicates d
		WHERE m.id = d.id
  		AND d.rn > 1;`

	CreateMoneroKeyImagesTable = `CREATE TABLE IF NOT EXISTS monero_key_images (
  		id SERIAL8 PRIMARY KEY,
  		key_image TEXT NOT NULL,   -- hex
  		spent_tx_hash TEXT,               -- tx hash that spent this key image (if known)
  		spent_block_height BIGINT,
  		first_seen_tx_hash TEXT,          -- tx where this key image appeared
  		first_seen_block_height BIGINT,
  		first_seen_time BIGINT,
  		created_at TIMESTAMPTZ DEFAULT now()
	);`
	InsertMoneroKeyImagesV0 = `INSERT INTO monero_key_images (key_image, spent_tx_hash, spent_block_height, first_seen_tx_hash, first_seen_block_height, first_seen_time)
	VALUES ($1,$2,$3,$4,$5,$6)`

	InsertMoneroKeyImages = InsertMoneroKeyImagesV0 + ` RETURNING id;`
	UpsertMoneroKeyImages = InsertMoneroKeyImagesV0 + ` ON CONFLICT (key_image) DO UPDATE SET first_seen_tx_hash = COALESCE(monero_key_images.first_seen_tx_hash, EXCLUDED.first_seen_tx_hash) RETURNING id;`

	IndexMoneroKeyImagesOnKeyImage = `CREATE UNIQUE INDEX uix_monero_key_images_key_image
		ON monero_key_images(key_image);`
	DeindexMoneroKeyImagesOnKeyImage = `DROP INDEX uix_monero_key_images_key_image;`

	IndexMoneroKeyImagesOnBlockHeight = `CREATE INDEX uix_monero_key_images_block_height
		ON monero_key_images(spent_block_height);`
	DeindexMoneroKeyImagesOnBlockHeight = `DROP INDEX uix_monero_key_images_block_height;`

	IndexMoneroKeyImagesOnFirstSeenBlHeight = `CREATE INDEX uix_monero_key_images_first_seen_bl_height
		ON monero_key_images(first_seen_block_height);`
	DeindexMoneroKeyImagesOnFirstSeenBlHeight = `DROP INDEX uix_monero_key_images_first_seen_bl_height;`

	DeleteMoneroKeyImagesWithMinFirstSeenBlHeight = `DELETE FROM monero_key_images WHERE first_seen_block_height > $1`

	CheckAndRemoveDuplicateMoneroKeyImageRows = `WITH duplicates AS (
  		SELECT id, row_number() OVER (PARTITION BY key_image ORDER BY id) AS rn
  		FROM public.monero_key_images
  		WHERE key_image IS NOT NULL)
		DELETE FROM public.monero_key_images m
		USING duplicates d
		WHERE m.id = d.id
  		AND d.rn > 1;`

	CreateMoneroRingMembers = `CREATE TABLE IF NOT EXISTS monero_ring_members (
  		id SERIAL8 PRIMARY KEY,
  		tx_hash TEXT NOT NULL,       -- tx that contains the input
  		tx_input_index INT4 NOT NULL,-- which input in tx
  		ring_position INT4 NOT NULL, -- position inside the ring
  		member_global_index BIGINT,  -- referenced global index (an output index used as decoy)
  		created_at TIMESTAMPTZ DEFAULT now()
	);`

	InsertMoneroRingMemberV0 = `INSERT INTO monero_ring_members (tx_hash, tx_input_index, ring_position, member_global_index)
	VALUES ($1,$2,$3,$4)`
	InsertMoneroRingMemberAllRow    = InsertMoneroRingMemberV0 + ` RETURNING id;`
	InsertMoneroRingMemberWithCheck = InsertMoneroRingMemberV0 + ` ON CONFLICT (tx_hash, tx_input_index, ring_position) DO NOTHING RETURNING id`
	IndexMoneroRingMembersOnTxHash  = `CREATE UNIQUE INDEX uix_monero_ring_members_txhash_txinput_idx
		ON monero_ring_members(tx_hash, tx_input_index, ring_position);`
	DeindexMoneroRingMembersOnTxHash = `DROP INDEX uix_monero_ring_members_txhash_txinput_idx;`

	IndexMoneroRingMembersOnMemberGlobalIdx = `CREATE INDEX uix_monero_ring_members_member_global_idx
		ON monero_ring_members(member_global_index);`
	DeindexMoneroRingMembersOnMemberGlobalIdx = `DROP INDEX uix_monero_ring_members_member_global_idx;`

	DeleteRingMembersWithTxhashArray = `DELETE FROM monero_ring_members WHERE tx_hash = ANY($1)`

	CheckAndRemoveDuplicateMoneroRingMembers = `WITH duplicates AS (
  		SELECT id, row_number() OVER (PARTITION BY tx_hash, tx_input_index, ring_position ORDER BY id) AS rn
  		FROM public.monero_ring_members
  		WHERE tx_hash IS NOT NULL AND tx_input_index IS NOT NULL AND ring_position IS NOT NULL)
		DELETE FROM public.monero_ring_members m
		USING duplicates d
		WHERE m.id = d.id
  		AND d.rn > 1;`

	CreateMoneroRctData = `CREATE TABLE IF NOT EXISTS monero_rct_data (
  		id SERIAL8 PRIMARY KEY,
  		tx_hash TEXT NOT NULL,
  		rct_blob BYTEA,         -- raw rct signatures / prunable data if needed
  		rct_prunable_hash TEXT,
  		rct_type INT,
  		created_at TIMESTAMPTZ DEFAULT now()
	);`

	InsertMoneroRctDataV0 = `INSERT INTO monero_rct_data (tx_hash, rct_blob, rct_prunable_hash, rct_type)
	VALUES ($1,$2,$3,$4)`
	InsertMoneroRctDataAllRows = InsertMoneroRctDataV0 + ` RETURNING id;`
	InsertMoneroRctDataChecked = InsertMoneroRctDataV0 + ` ON CONFLICT (tx_hash) DO NOTHING RETURNING id;`

	IndexMoneroRctDataOnTxHash = `CREATE UNIQUE INDEX uix_monero_rct_data_txhash
		ON monero_rct_data(tx_hash);`
	DeindexMoneroRctDataOnTxHash = `DROP INDEX uix_monero_rct_data_txhash;`

	DeleteRctDataWithTxhashArray             = `DELETE FROM monero_rct_data WHERE tx_hash = ANY($1)`
	CheckAndRemoveDuplicateMoneroRctDataRows = `WITH duplicates AS (
  		SELECT id, row_number() OVER (PARTITION BY tx_hash ORDER BY id) AS rn
  		FROM public.monero_rct_data
  		WHERE tx_hash IS NOT NULL)
		DELETE FROM public.monero_rct_data m
		USING duplicates d
		WHERE m.id = d.id
  		AND d.rn > 1;`
)

func MakeInsertMoneroVoutsAllRowQuery(checked bool) string {
	if checked {
		return InsertMoneroVoutsChecked
	}
	return InsertMoneroVoutsAllRow
}

func MakeInsertMoneroRingMemberQuery(checked bool) string {
	if checked {
		return InsertMoneroRingMemberWithCheck
	} else {
		return InsertMoneroRingMemberAllRow
	}
}

func MakeInsertMoneroKeyImagesQuery(checked bool) string {
	if checked {
		return UpsertMoneroKeyImages
	} else {
		return InsertMoneroKeyImages
	}
}

func MakeInsertMoneroRctDataQuery(checked bool) string {
	if checked {
		return InsertMoneroRctDataChecked
	} else {
		return InsertMoneroRctDataAllRows
	}
}
