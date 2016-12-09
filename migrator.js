/**
 * This script is intended to help resolving existing duplicate teams. Duplicates are identified by their
 * code property. It will give you one of three options:
 *
 * 1) One of the duplicates can be migrated to the new code format, thus resolving the issue
 * 2) Both duplicates are on the same business object level, but at least one of them has no users: manually delete
 *    the team without users
 * 3)  Both duplicates are on the same business object level and both have users assigned:
 *    Customer needs to be asked to merge the teams manually
 *
 * This script runs directly on MongoDB. Use:
 * mongo fh-aaa --eval "var domain='<DOMAIN>'; var dryrun=<true|false>" migrate.js
 *
 * The `domain` and `dryrun` properties need to be passed in. Without a domain the new code can not
 * be generated and it cannot be inferred automatically.
 *
 * If `dryrun` is set to true (default) the script will tell you what it would do but not actually
 * run any update commands.
 */

function log(msg) {
  print("--(LOG)> " + msg);
}

// Return the lowest level business object
function getLowestLevel(team) {
  var boh = team["business-objects"];
  var hierarchy = Object.keys(boh);

  return hierarchy.sort(function (a, b) {
    return b.length - a.length;
  })[0];
}

// Create the new team code as a combination of the lowest level business
// object's guids, the domain and the team name
function createTeamCode(team) {
  var lowestLevel = getLowestLevel(team);
  var lowestLevelBOs = team["business-objects"][lowestLevel];
  var guidString = lowestLevelBOs.join("-");
  return [domain, guidString, team.name].join("-").replace(/\s/g, "_");
}

// Check the duplicates and decide if and what we can do about them:
// Same level, both have users: no migration possible, consult customer
// Same level, one or both have no users: delete one of them
// Different level, one or both have no users: delete on of them
// Different level, both have users: perform migration
function checkDups(dups) {
  var fa = dups[0];
  var fb = dups[1];

  var lowestA = getLowestLevel(fa);
  var lowestB = getLowestLevel(fb);
  if (lowestA === lowestB) {
    if (fa.users.length !== 0 && fb.users.length !== 0) {
      log("Problem with team '" + fa.name + "': Duplicates on the same level. Consult customer. ");
      return false;
    } else {
      log("Duplicate teams on same level, but one of them can be deleted because it has no users");
      log(fa.name + " (" + fa._id + ") has " + fa.users.length + " users");
      log(fb.name + " (" + fb._id + ") has " + fb.users.length + " users");
      return false;
    }
  } else {
    if (fa.users.length !== 0 && fb.users.length !== 0) {
      log("Duplicate teams '" + fa.name + "' on different levels. Can be migrated");
      return true;
    } else {
      log("Duplicate teams on different levels, but one of them can be deleted because it has no users");
      log(fa.name + " (" + fa._id + ") has " + fa.users.length + " users");
      log(fb.name + " (" + fb._id + ") has " + fb.users.length + " users");
      return false;
    }
  }
}

function main() {
  // Sanity checks
  if (typeof domain === "undefined") {
    throw new Error("Domain must be defined");
  }

  // Default `dryrun` to true even if not passed
  if (typeof dryrun === "undefined") {
    dryrun = true;
  }

  if (db.getName() !== "fh-aaa") {
    throw new Error("Script must be run on fh-aaa database");
  }

  log("using domain: " + domain);

  // Search for duplicates...
  var result = db.teams.aggregate([{"$group": {_id: "$code", count: {$sum: 1}}}]).result;
  var relevantResults = [];

  // ...and store them
  for (var i = 0; i < result.length; i++) {
    if (result[i].count > 1) {
      relevantResults.push(result[i]);
    }
  }

  // No duplicates found
  if (relevantResults.length <= 0) {
    log("All good, nothing to do. Aborting script.");
    return;
  }

  for (var i = 0; i < relevantResults.length; i++) {
    var team = relevantResults[i];
    // We do not mess with default teams
    if (team.defaultTeam) {
      continue;
    }

    // Get the details of the duplicate teams
    var dups = db.teams.find({defaultTeam: false, code: team["_id"]}).toArray();

    if (checkDups(dups)) {
      var teamToMigrate = dups[0];
      log("migrating " + teamToMigrate.name + " (" + teamToMigrate._id + ")");
      var newCode = createTeamCode(teamToMigrate);
      teamToMigrate.code = newCode;

      var mongoUpdateCmd = {
        query: {_id: teamToMigrate._id},
        document: teamToMigrate
      };

      if (dryrun) {
        printjson(mongoUpdateCmd);
        log("dry run. no operations have been performed.");
      } else {
        db.teams.update(mongoUpdateCmd.query, mongoUpdateCmd.document);
        log(teamToMigrate.name + " code has been changed to: " + teamToMigrate.code);
      }
    }
    log("----- done");
  }
}

main();
