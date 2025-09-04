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
  		vout_row_id INT8,              -- if you want to link to existing vouts table rows
  		created_at TIMESTAMPTZ DEFAULT now()
	);`
	IndexMoneroVoutTableOnTxHash = `CREATE INDEX uix_monero_outputs_txhash
		ON monero_outputs(tx_hash);`
	DeindexMoneroVoutTableOnTxHash = `DROP INDEX uix_monero_outputs_txhash;`

	IndexMoneroVoutTableOnGlobalIndex = `CREATE INDEX uix_monero_outputs_global_index
		ON monero_outputs(global_index);`
	DeindexMoneroVoutTableOnGlobalIndex = `DROP INDEX uix_monero_outputs_global_index;`

	IndexMoneroVoutTableOnOutPk = `CREATE INDEX uix_monero_outputs_out_pk
		ON monero_outputs(out_pk);`
	DeindexMoneroVoutTableOnOutPk = `DROP INDEX uix_monero_outputs_out_pk;`

	CreateMoneroKeyImagesTable = `CREATE TABLE IF NOT EXISTS monero_key_images (
  		id SERIAL8 PRIMARY KEY,
  		key_image TEXT NOT NULL UNIQUE,   -- hex
  		spent_tx_hash TEXT,               -- tx hash that spent this key image (if known)
  		spent_block_height BIGINT,
  		first_seen_tx_hash TEXT,          -- tx where this key image appeared
  		first_seen_block_height BIGINT,
  		first_seen_time BIGINT,
  		created_at TIMESTAMPTZ DEFAULT now()
	);`

	IndexMoneroKeyImagesOnBlockHeight = `CREATE INDEX uix_monero_key_images_block_height
		ON monero_key_images(spent_block_height);`
	DeindexMoneroKeyImagesOnBlockHeight = `DROP INDEX uix_monero_key_images_block_height;`

	CreateMoneroRingMembers = `CREATE TABLE IF NOT EXISTS monero_ring_members (
  		id SERIAL8 PRIMARY KEY,
  		tx_hash TEXT NOT NULL,       -- tx that contains the input
  		tx_input_index INT4 NOT NULL,-- which input in tx
  		ring_position INT4 NOT NULL, -- position inside the ring
  		member_global_index BIGINT,  -- referenced global index (an output index used as decoy)
  		created_at TIMESTAMPTZ DEFAULT now()
	);`

	IndexMoneroRingMembersOnTxHashInputIndex = `CREATE INDEX uix_monero_ring_members_txhash_txinput_idx
		ON monero_ring_members(tx_hash, tx_input_index);`
	DeindexMoneroRingMembersOnTxHashInputIndex = `DROP INDEX uix_monero_ring_members_txhash_txinput_idx;`

	IndexMoneroRingMembersOnMemberGlobalIdx = `CREATE INDEX uix_monero_ring_members_member_global_idx
		ON monero_ring_members(member_global_index);`
	DeindexMoneroRingMembersOnMemberGlobalIdx = `DROP INDEX uix_monero_ring_members_member_global_idx;`

	CreateMoneroRctData = `CREATE TABLE IF NOT EXISTS monero_rct_data (
  		id SERIAL8 PRIMARY KEY,
  		tx_hash TEXT NOT NULL UNIQUE,
  		rct_blob BYTEA,         -- raw rct signatures / prunable data if needed
  		rct_prunable_hash TEXT,
  		rct_type INT,
  		created_at TIMESTAMPTZ DEFAULT now()
	);`
)
