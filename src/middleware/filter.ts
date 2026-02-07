
/*
// SQL query filter
async function filterQuery(query, pool) {
  try {
    const [rows] = await pool.query("SELECT query FROM debied_queries");

    const lowerQuery = query.toLowerCase(); // lowercase the user input

    return !rows.some(row => {
      const denied = row.query?.trim().toLowerCase(); // lowercase and trim DB entry
      return denied && lowerQuery.includes(denied);
    });
  } catch (err) {
    console.error("DB error:", err);
    return false; // safer to block
  }
}


// Command filter (DB-driven)
async function filterCMD(cmd, pool) {
  try {
    const [rows] = await pool.query("SELECT command FROM denied_commands");
    return !rows.some(row => cmd.includes(row.command));
  } catch (err) {
    console.error("DB error:", err);
    return false; // safer to block
  }
}

module.exports = { filterQuery, filterCMD };
*/