/* 
const pool = require('../config/mysql_config.js');
const {filterCMD} =require('../middleware/filter.js');
const exec = require('child_process').exec;
exports.executeCmd =async(req,res)=>{
     const cmd = req.body.cmd;

  if (!cmd) {
    return res.status(400).send({ error: "No command provided" });
  }

  // Check command against denied list
  const allowed = await filterCMD(cmd,pool);
  if (!allowed) {
    return res.status(403).send({ error: "Command is blocked" });
  }

  exec(cmd, (error, stdout, stderr) => {
    if (error) {
      return res.status(500).send({ error: stderr || error.message });
    }
    res.send({ output: stdout });
  });
}
  */