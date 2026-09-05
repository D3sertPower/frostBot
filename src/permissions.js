'use strict';

const fs = require('fs')
const GROUPS = new Map([])
const GROUP_PERMISSIONS = new Map([])
const PERMISSIONS = ["WITHDRAW_ANYTHING", "NO_COOLDOWNS", "MANAGE_TRADES", "SEE_STATISTICS", "SEE_REPORTS", "SET_GROUPS"
]
const { code } = require('./chat-format')
const groupData = fs.readFileSync('groups.json', 'utf8');
const permissionData = fs.readFileSync('permissions.json', 'utf8')
// Pull groups and users
try {

  var pData = JSON.parse(permissionData)
  var gData = JSON.parse(groupData);

  Object.entries(gData).forEach(([steamID, group]) => {
    GROUPS.set(steamID, group)
  });

  Object.entries(pData).forEach(([group, perms]) => {
    var valid_perms = []
    for (const perm of perms) {
      if (PERMISSIONS.includes(perm)) {
      valid_perms.push(perm)
      }
      else {
      console.warn(`Invalid permisison ${perm} in permissions.json!`)
      }
    }
    GROUP_PERMISSIONS.set(group, valid_perms) 
    });

} catch (error) {
  console.error('Error:', error);
}

function checkPermission(steamID, permission) {
  var userGroup = getGroup(steamID)
  if (permission === undefined) {
    return true
  }
  if (!PERMISSIONS.includes(permission)) {
    console.warn(`Permission ${permission}, is not a valid permission.`)
    return false
  }
  if (userGroup != undefined) {
  return GROUP_PERMISSIONS.get(userGroup).includes(permission)
  }
  return false
}

function accessDeniedMessage() {
  return code([
        '🧨 What are you trying to do, kid?',
        'You are not allowed to use this command.'
      ])
}

async function setGroup(steamID, newUserGroup) {
  try { 
  GROUPS.set(steamID, newUserGroup)

  var groupsDotJson = JSON.stringify(Object.fromEntries(GROUPS), null, 2)
  await fs.promises.writeFile('groups.json', groupsDotJson, 'utf8', (err) => {
    if (err) throw err,
    console.log('Groups file updated.')
  });

  console.log(`Updated user ${steamID} group to ${newUserGroup}`)
  }
  catch(e) {
  console.error('Erro:', e)
  }
}

function getGroup(steamID) {
  var userGroup = GROUPS.get(steamID)
  if (userGroup != undefined) {
    return userGroup
  }
  setGroup(steamID, "USER")
  console.warn(`Auto-role system failed, setting ${steamID}'s group manually.`)
  return "USER"
}

module.exports = { checkPermission, setGroup, getGroup, accessDeniedMessage };