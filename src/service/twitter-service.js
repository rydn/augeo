
  /***************************************************************************/
  /* Augeo.io is a web application that uses Natural Language Processing to  */
  /* classify a user's internet activity into different 'skills'.            */
  /* Copyright (C) 2016 Brian Redd                                           */
  /*                                                                         */
  /* This program is free software: you can redistribute it and/or modify    */
  /* it under the terms of the GNU General Public License as published by    */
  /* the Free Software Foundation, either version 3 of the License, or       */
  /* (at your option) any later version.                                     */
  /*                                                                         */
  /* This program is distributed in the hope that it will be useful,         */
  /* but WITHOUT ANY WARRANTY; without even the implied warranty of          */
  /* MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the           */
  /* GNU General Public License for more details.                            */
  /*                                                                         */
  /* You should have received a copy of the GNU General Public License       */
  /* along with this program.  If not, see <http://www.gnu.org/licenses/>.   */
  /***************************************************************************/

  /***************************************************************************/
  /* Description: Handles logic interfacing with the TWEET and MENTION       */
  /*              collections                                                */
  /***************************************************************************/

  // Required files
  var Mongoose = require('mongoose');
  var AugeoDB = require('../model/database');

  // Required local modules
  var AugeoUtility = require('../utility/augeo-utility');
  var AugeoValidator = require('../validator/augeo-validator');
  var Classifier = require('../classifier/twitter-classifier');
  var Logger = require('../module/logger');
  var TwitterUtility = require('../utility/twitter-utility');
  var TwitterValidator = require('../validator/twitter-validator');

  // Constants
  var SERVICE = 'twitter-service';

  // Schemas
  require('../model/schema/augeo/activity');
  require('../model/schema/augeo/user');
  require('../model/schema/twitter/tweet');
  require('../model/schema/twitter/user');

  // Global variables
  var Activity = AugeoDB.model('ACTIVITY');
  var Tweet = AugeoDB.model('TWITTER_TWEET');
  var TwitterUser = AugeoDB.model('TWITTER_USER');
  var User = AugeoDB.model('AUGEO_USER');
  var classifier = new Classifier();
  var log = new Logger();

  exports.addAction = function(action, tweet, logData, callback) {
    log.functionCall(SERVICE, 'addAction', logData.parentProcess, logData.username, {'action.actionerScreenName': (action)?action.actionerScreenName:'invalid',
      'tweet.tweetId':(tweet)?tweet.tweetId:'invalid'});

    Tweet.findTweet(action.tweetId, logData, function(returnedTweet) {

      // Make sure tweet is unique
      if(returnedTweet.length === 0) {

        // Find twitterId for actioner
        TwitterUser.getUserWithScreenName(action.actionerScreenName, logData, function(actioner) {

          // Find twitterId for actionee
          TwitterUser.getUserWithScreenName(action.actioneeScreenName, logData, function(actionee) {

            if(actioner || actionee) {
              // Insert tweets into tweet table
              Tweet.addTweet(tweet, logData, function(insertedTweet) {

                var actionerSubmitted = false;
                var actioneeSubmitted = false;
                var submitCallback = function(user, classification, callback) {
                  if(user == 'actioner') {
                    actionerSubmitted = true;
                  } else if(user == 'actionee') {
                    actioneeSubmitted = true;
                  }

                  if(actionerSubmitted && actioneeSubmitted) {
                    callback(classification);
                  }
                };

                if(actioner) {
                  var activity = extractActivity(insertedTweet, tweet.date, true, false, false, logData);
                  activity.user = actioner._id;
                  Activity.addActivity(activity, logData, function(){});
                  User.updateSkillData(actioner._id, formatExperience(activity.experience, activity.classification, logData), logData, function() {
                    submitCallback('actioner', activity.classification, callback);
                  });
                } else {
                  actionerSubmitted = true;
                }

                if(actionee) {
                  var activity = extractActivity(insertedTweet, tweet.date, true, true, action.isRetweet, logData);
                  activity.user = actionee._id;

                  if(action.isRetweet) {
                    Tweet.incrementRetweetCount(action.retweetId, logData, function(actioneeTweet) {
                      Activity.increaseExperience(activity.user, actioneeTweet._id, activity.experience, logData, function() {}); // Increase activity experience
                    }); // Increment retweet count
                  } else {
                    Activity.addActivity(activity, logData, function(){});
                  }

                  User.updateSkillData(actionee._id, formatExperience(activity.experience, activity.classification, logData), logData, function() {
                    submitCallback('actionee', activity.classification, callback);
                  });

                } else {
                  actioneeSubmitted = true;
                }
              });
            }
          }); // End getUserWithScreenName for actionee
        }); // End getUserWithScreenName for actioner
      }
    }); // End findTweet
  };

  // Add tweets to the given user
  exports.addTweets = function(userId, screenName, userTweets, areMentions, logData, callback) {
    log.functionCall(SERVICE, 'addTweets', logData.parentProcess, logData.username, {'userId':userId, 'screenName':screenName,
      'userTweets':(userTweets)?userTweets.length:'invalid'});

    if(userTweets.length > 0) {
      // Add the user's tweets to the TWEET collection
      Tweet.addTweets(userTweets, logData, function (insertedTweets) {

        var activities = new Array();
        for (var i = 0; i < insertedTweets.length; i++) {
          var activity = extractActivity(insertedTweets[i], userTweets[i].date, true, areMentions, false, logData);
          activity.user = userId;
          activities.push(activity);
        }

        // Add activities to ACTIVITY collection
        Activity.addActivities(activities, logData, function () {

          // Determine experience from tweets
          var skillsExperience = calculateSkillsExperience(activities, logData);

          // Update user's experience
          User.updateSkillData(userId, skillsExperience, logData, function () {
            callback();
          }); // End updateSkillData
        });
      }); // End addTweets
    } else {
      callback();
    }
  };

  exports.addUserSecretToken = function(userId, secretToken, logData, callback, rollback) {
    log.functionCall(SERVICE, 'addUserSecretToken', logData.parentProcess, logData.username, {'userId':userId, 'secretToken':secretToken});

    TwitterUser.add(userId, secretToken, logData, function(success) {
      if(success) {
        callback();
      } else {
        rollback('Failed to add Twitter secret access token');
      }
    });
  };

  exports.connectToTwitter = function(restQueue, streamQueue, logData, callback) {
    log.functionCall(SERVICE, 'connectToTwitter', logData.parentProcess, logData.username, {'restQueue':(restQueue)?'valid':'invalid',
      'streamQueue':(streamQueue)?'valid':'invalid'});

    // Get all users twitterId's
    exports.getUsers(logData, function(users) {

      if(users.length > 0) {

        var streamQueueData = {
          action: 'Open',
          data: users,
          logData: logData,
          callback: function(tweetData) {
            var queueData = {};
            queueData.action = 'Add';
            queueData.data = tweetData;
            streamQueue.addAction(queueData, logData, function(){});
          },
          removeCallback: function(tweetData) {
            var queueData = {};
            queueData.action = 'Remove';
            queueData.data = tweetData;
            streamQueue.addAction(queueData, logData, function() {});
          },
          connectedCallback: function() {
            restQueue.addAllUsersToQueues('ALL', logData, function(){});
          }
        };

        streamQueue.openStream(streamQueueData, function(){}); // End openStream
      }
      callback();
    });
  };

  exports.checkExistingAccessToken = function(accessToken, logData, callback, rollback) {
    log.functionCall(SERVICE, 'checkExistingAccessToken', logData.parentProcess, logData.username, {'accessToken':accessToken});

    TwitterUser.checkExistingAccessToken(accessToken, logData, function(existingAccessToken) {

      if(existingAccessToken != undefined) {
        callback(existingAccessToken);
      } else {
        rollback('The retrieved existingAccessToken is undefined');
      }
    });
  };

  exports.getAllUsersQueueData = function(logData, callback) {
    log.functionCall(SERVICE, 'getAllUsersQueueData', logData.parentProcess, logData.username);

    TwitterUser.getAllQueueData(logData, callback);
  };

  exports.getLatestMentionTweetId = function(screenName, logData, callback) {
    log.functionCall(SERVICE, 'getLatestMentionTweetId', logData.parentProcess, logData.username, {'screenName':screenName});

    Tweet.getLatestMentionTweetId(screenName, logData, callback);
  };

  exports.getLatestTweetId = function(screenName, logData, callback) {
    log.functionCall(SERVICE, 'getLatestTweetId', logData.parentProcess, logData.username, {'screenName':screenName});

    Tweet.getLatestTweetId(screenName, logData, callback);
  };

  exports.getQueueData = function(userId, screenName, logData, callback, rollback) {
    log.functionCall(SERVICE, 'getQueueData', logData.parentProcess, logData.username, {'userId':userId, 'screenName':screenName});

    if (AugeoValidator.isMongooseObjectIdValid(userId, logData) && TwitterValidator.isScreenNameValid(screenName, logData)) {

      // Get user's access tokens
      TwitterUser.getTokens(userId, logData, function(tokens) {

        if(tokens) {
          TwitterUser.doesUserExist(screenName, logData, function(userExists) {

            if(userExists) {
              var accessToken = tokens.accessToken;
              var secretAccessToken = tokens.secretAccessToken;

              var queueData = {
                tweetQueueData: {
                  userId: new Mongoose.Types.ObjectId(userId),
                  screenName: screenName,
                  accessToken: accessToken,
                  secretAccessToken: secretAccessToken,
                  isNewUser: true
                },

                mentionQueueData: {
                  userId: new Mongoose.Types.ObjectId(userId),
                  screenName: screenName,
                  accessToken: accessToken,
                  secretAccessToken: secretAccessToken,
                  isNewUser: true
                }
              }
              callback(queueData);
            } else {
              rollback('User does not exist');
            }
          });
        } else {
          rollback('User tokens do not exist');
        }
      });
    } else {
      rollback('Invalid input');
    }
  };

  // Call DB to get all users Twitter Id's
  exports.getUsers = function(logData, callback) {
    log.functionCall(SERVICE, 'getUsers', logData.parentProcess, logData.username);

    TwitterUser.getUsers(logData, callback);
  };

  exports.getUserSecretToken = function(userId, logData, callback, rollback) {
    log.functionCall(SERVICE, 'getUserSecretToken', logData.parentProcess, logData.username, {'userId':userId});

    TwitterUser.getTokens(userId, logData, function(tokens) {
      if(tokens && tokens.secretToken) {
        callback(tokens.secretToken);
      } else {
        rollback('Secret token retrieved is undefined');
      }
    });
  };

  // TODO: Complete this
  // Current logic deletes tweet and updates user experience
  // Need to loop through mentionees of tweet and remove mentions from Mention table and update mentionees experience
  // Since stream logic can only detect replies, need to only update experience for deleted entries for replies or any
  // mention before the date of signing up with Augeo.
  // Need to update tests for TwitterTestInterface
  exports.removeTweet = function(tweetData, logData, callback) {
    log.functionCall(SERVICE, 'removeTweet', logData.parentProcess, logData.username, {'tweetData.id_str':(tweetData)?tweetData.id_str:'invalid'});

    // Get User's ID
    TwitterUser.getUserWithTwitterId(tweetData.user_id_str, logData, function(user) {

      // Get tweet to be removed from database
      Tweet.findTweet(tweetData.id_str, logData, function (tweet) {
        Activity.getActivity(user._id, tweet[0]._id, logData, function(activity) {

          var tweetExperience = activity[0].experience * -1;
          var classification = activity[0].classification;

          // Remove tweet
          Tweet.removeTweet(tweetData.id_str, logData, function () {
            Activity.removeActivity(user._id, tweet._id, logData, function() {

              // Set subskills experience
              var subSkillsExperience = AugeoUtility.initializeSubSkillsExperienceArray(AugeoUtility.SUB_SKILLS, logData);
              subSkillsExperience[classification] += tweetExperience;

              var experience = {
                mainSkillExperience: tweetExperience,
                subSkillsExperience: subSkillsExperience
              };

              // Update users experience
              User.updateSkillData(user._id, experience, logData, function () {
                callback(classification);
              });
            });
          });
        });
      });
    });
  };

  exports.removeUser = function(augeoId, logData, callback) {
    log.functionCall(SERVICE, 'removeUser', logData.parentProcess, logData.username, {'augeoId': augeoId});
    TwitterUser.remove(augeoId, logData, callback);
  };

  // Call DB to update user's twitter information
  exports.updateTwitterInfo = function(userId, sessionUser, userData, logData, callback, rollback) {
    log.functionCall(SERVICE, 'updateTwitterInfo', logData.parentProcess, logData.username, {'userId':userId, 'sessionUser.username':(sessionUser)?sessionUser.username:'invalid',
      'userData.screenName':(userData)?userData.screenName:'invalid'});

    // Validate userId
    if(AugeoValidator.isMongooseObjectIdValid(userId, logData)) {

      TwitterUser.updateUser(userId, userData, sessionUser.username, logData, function () {

        // Don't update profile image if one already exists
        if (sessionUser.profileImg != 'image/avatar-medium.png') {
          userData.profileImageUrl = sessionUser.profileImg;
        }

        // Don't update profile icon if one already exists
        if (sessionUser.profileIcon != 'image/avatar-small.png') {
          userData.profileIcon = sessionUser.profileIcon;
        }

        User.setProfileImage(sessionUser.username, userData.profileImageUrl, userData.profileIcon, logData, function () {
          User.getUserWithUsername(sessionUser.username, logData, function (updatedUser) {
            callback(updatedUser);
          });
        });
      });
    } else {
      rollback();
    }
  };

  /***************************************************************************/
  /* Private Functions                                                       */
  /***************************************************************************/

  // Calculate skills experience based on tweets and mentions
  var calculateSkillsExperience = function(activities, logData) {
    log.functionCall(SERVICE, 'calculateSkillsExperience (private)', logData.parentProcess, logData.username, {'activities.length':(activities)?activities.length:'invalid'});

    var mainSkillExperience = 0;
    var subSkillsExperience = AugeoUtility.initializeSubSkillsExperienceArray(AugeoUtility.SUB_SKILLS, logData);
    for(var i = 0; i < activities.length; i++) {
      var activity = activities[i];

      // Add tweet experience to mainSkill
      mainSkillExperience += activity.experience;

      // Add experience to subSkill
      subSkillsExperience[activity.classification] += activity.experience;
    }

    var experience = {
      mainSkillExperience: mainSkillExperience,
      subSkillsExperience: subSkillsExperience
    };

    return experience;
  };

  var extractActivity = function(tweet, timestamp, checkClassification, isMention, isRetweet, logData) {
    log.functionCall(SERVICE, 'extractActivity', logData.parentProcess, logData.username, {'tweet':(tweet)?tweet.tweetId:'invalid',
      'checkClassification':checkClassification, 'isMention':isMention});

    var tweetExperience;
    if(isMention) {
      if(isRetweet) {
        tweetExperience = TwitterUtility.RETWEET_EXPERIENCE;
      } else {
        tweetExperience = TwitterUtility.MENTION_EXPERIENCE;
      }
    } else {
      tweetExperience = TwitterUtility.calculateTweetExperience(tweet.retweetCount, tweet.favoriteCount, logData);
    }

    var classification = classifier.classify(tweet.text, logData);

    // Check for an Augeo hashtag and classify text if it is accurate
    if(checkClassification) {
      var tweetHashtags = tweet.hashtags;
      var classifications = classifier.getClassifications(tweet.text, logData);
      for(var j = 0; j < tweetHashtags.length; j++) {
        if(TwitterUtility.containsAugeoHashtag(tweetHashtags[j], logData)) {
          for(var k = 0; k < 3; k++) { // Only compare first 3 classifications
            if(tweetHashtags[j].substring('augeo'.length) === classifications[k].label) {
              classification = classifications[k].label;
              break;
            }
          }
        }
      }
    }

    return {
      classification: classification,
      classificationGlyphicon: AugeoUtility.getGlyphicon(classification, logData),
      experience: tweetExperience,
      data: tweet._id,
      kind: 'TWITTER_TWEET',
      timestamp: new Date(timestamp)
    };
  };

  var formatExperience = function(experience, classification, logData) {
    log.functionCall(SERVICE, 'formatExperience (private)', logData.parentProcess, logData.username, {'experience':experience,
      'classification':classification});

    // Set subskills experience
    var subSkillsExperience = AugeoUtility.initializeSubSkillsExperienceArray(AugeoUtility.SUB_SKILLS, logData);
    subSkillsExperience[classification] += experience;

    return {
      mainSkillExperience: experience,
      subSkillsExperience: subSkillsExperience
    }
  };
