module.exports = function(crowi) {
  var debug = require('debug')('crowi:models:user')
    , mongoose = require('mongoose')
    , mongoosePaginate = require('mongoose-paginate')
    , crypto = require('crypto')
    , async = require('async')
    , ObjectId = mongoose.Schema.Types.ObjectId

    , STATUS_REGISTERED = 1
    , STATUS_ACTIVE     = 2
    , STATUS_SUSPENDED  = 3
    , STATUS_DELETED    = 4
    , STATUS_INVITED    = 5
    , USER_PUBLIC_FIELDS = '_id fbId image googleId name username email status createdAt' // TODO: どこか別の場所へ...

    , PAGE_ITEMS        = 20

    , userEvent = crowi.event('user')

    , userSchema;

  userSchema = new mongoose.Schema({
    userId: String,
    fbId: String, // userId
    image: String,
    googleId: String,
    name: { type: String },
    username: { type: String, index: true },
    email: { type: String, required: true, index: true  },
    introduction: { type: String },
    password: String,
    apiToken: String,
    status: { type: Number, required: true, default: STATUS_ACTIVE, index: true  },
    createdAt: { type: Date, default: Date.now },
    admin: { type: Boolean, default: 0, index: true  }
  });
  userSchema.plugin(mongoosePaginate);

  userEvent.on('activated', userEvent.onActivated);

  function decideUserStatusOnRegistration () {
    var Config = crowi.model('Config'),
      config = crowi.getConfig();

    if (!config.crowi) {
      return STATUS_ACTIVE; // is this ok?
    }

    // status decided depends on registrationMode
    switch (config.crowi['security:registrationMode']) {
      case Config.SECURITY_REGISTRATION_MODE_OPEN:
        return STATUS_ACTIVE;
      case Config.SECURITY_REGISTRATION_MODE_RESTRICTED:
      case Config.SECURITY_REGISTRATION_MODE_CLOSED: // 一応
        return STATUS_REGISTERED;
      default:
        return STATUS_ACTIVE; // どっちにすんのがいいんだろうな
    }
  }

  function generatePassword (password) {
    var hasher = crypto.createHash('sha256');
    hasher.update(crowi.env.PASSWORD_SEED + password);

    return hasher.digest('hex');
  }

  function generateApiToken (user) {
    var hasher = crypto.createHash('sha256');
    hasher.update((new Date).getTime() + user._id);

    return hasher.digest('base64');
  }

  userSchema.methods.isPasswordSet = function() {
    if (this.password) {
      return true;
    }
    return false;
  };

  userSchema.methods.isPasswordValid = function(password) {
    return this.password == generatePassword(password);
  };

  userSchema.methods.setPassword = function(password) {
    this.password = generatePassword(password);
    return this;
  };

  userSchema.methods.isEmailSet = function() {
    if (this.email) {
      return true;
    }
    return false;
  };

  userSchema.methods.update = function(name, email, callback) {
    this.name = name;
    this.email = email;
    this.save(function(err, userData) {
      return callback(err, userData);
    });
  };

  userSchema.methods.updatePassword = function(password, callback) {
    this.setPassword(password);
    this.save(function(err, userData) {
      return callback(err, userData);
    });
  };

  userSchema.methods.updateApiToken = function(callback) {
    var self = this;

    self.apiToken = generateApiToken(this);
    return new Promise(function(resolve, reject) {
      self.save(function(err, userData) {
        if (err) {
          return reject(err);
        } else {
          return resolve(userData);
        }
      });

    });
  };

  userSchema.methods.updateImage = function(image, callback) {
    this.image = image;
    this.save(function(err, userData) {
      return callback(err, userData);
    });
  };

  userSchema.methods.deleteImage = function(callback) {
    return this.updateImage(null, callback);
  };

  userSchema.methods.updateFacebookId = function(fbId, callback) {
    this.fbId = this.userId = fbId;
    this.save(function(err, userData) {
      return callback(err, userData);
    });
  };

  userSchema.methods.deleteFacebookId = function(callback) {
    return this.updateFacebookId(null, callback);
  };

  userSchema.methods.updateGoogleId = function(googleId, callback) {
    this.googleId = googleId;
    this.save(function(err, userData) {
      return callback(err, userData);
    });
  };

  userSchema.methods.deleteGoogleId = function(callback) {
    return this.updateGoogleId(null, callback);
  };

  userSchema.methods.activateInvitedUser = function(username, name, password, callback) {
    this.setPassword(password);
    this.name = name;
    this.username = username;
    this.status = STATUS_ACTIVE;
    this.save(function(err, userData) {
      userEvent.emit('activated', userData);
      return callback(err, userData);
    });
  };

  userSchema.methods.removeFromAdmin = function(callback) {
    debug('Remove from admin', this);
    this.admin = 0;
    this.save(function(err, userData) {
      return callback(err, userData);
    });
  };

  userSchema.methods.makeAdmin = function(callback) {
    debug('Admin', this);
    this.admin = 1;
    this.save(function(err, userData) {
      return callback(err, userData);
    });
  };

  userSchema.methods.statusActivate = function(callback) {
    debug('Activate User', this);
    this.status = STATUS_ACTIVE;
    this.save(function(err, userData) {
      userEvent.emit('activated', userData);
      return callback(err, userData);
    });
  };

  userSchema.methods.statusSuspend = function(callback) {
    debug('Suspend User', this);
    this.status = STATUS_SUSPENDED;
    if (this.email === undefined || this.email === null) { // migrate old data
      this.email = '-';
    }
    if (this.name === undefined || this.name === null) { // migrate old data
      this.name = '-' + Date.now();
    }
    if (this.username === undefined || this.usename === null) { // migrate old data
      this.username = '-';
    }
    this.save(function(err, userData) {
      return callback(err, userData);
    });
  };

  userSchema.methods.statusDelete = function(callback) {
    debug('Delete User', this);
    this.status = STATUS_DELETED;
    this.password = '';
    this.email = 'deleted@deleted';
    this.googleId = null;
    this.fbId = null;
    this.image = null;
    this.save(function(err, userData) {
      return callback(err, userData);
    });
  };

  userSchema.methods.updateGoogleIdAndFacebookId = function(googleId, facebookId, callback) {
    this.googleId = googleId;
    this.fbId = this.userId = facebookId;
    this.save(function(err, userData) {
      return callback(err, userData);
    });
  };

  userSchema.statics.getUserStatusLabels = function() {
    var userStatus = {};
    userStatus[STATUS_REGISTERED] = '承認待ち';
    userStatus[STATUS_ACTIVE] = 'Active';
    userStatus[STATUS_SUSPENDED] = 'Suspended';
    userStatus[STATUS_DELETED] = 'Deleted';
    userStatus[STATUS_INVITED] = '招待済み';

    return userStatus;
  };

  userSchema.statics.isEmailValid = function(email, callback) {
    var config = crowi.getConfig()
      , whitelist = config.crowi['security:registrationWhiteList'];

    if (Array.isArray(whitelist) && whitelist.length > 0) {
      return config.crowi['security:registrationWhiteList'].some(function(allowedEmail) {
        var re = new RegExp(allowedEmail + '$');
        return re.test(email);
      });
    }

    return true;
  };

  userSchema.statics.findUsers = function(options, callback) {
    var sort = options.sort || {status: 1, createdAt: 1};

    this.find()
      .sort(sort)
      .skip(options.skip || 0)
      .limit(options.limit || 21)
      .exec(function (err, userData) {
        callback(err, userData);
      });

  };

  userSchema.statics.findUsersByIds = function(ids, option) {
    var User = this;
    var option = option || {}
      , sort = option.sort || {createdAt: -1}
      , status = option.status || STATUS_ACTIVE
      , fields = option.fields || USER_PUBLIC_FIELDS
      ;


    return new Promise(function(resolve, reject) {
      User
        .find({ _id: { $in: ids }, status: status })
        .select(fields)
        .sort(sort)
        .exec(function (err, userData) {
          if (err) {
            return reject(err);
          }

          return resolve(userData);
        });
    });
  };

  userSchema.statics.findAdmins = function(callback) {
    var User = this;
    this.find({admin: true})
      .exec(function(err, admins) {
        debug('Admins: ', admins);
        callback(err, admins);
      });
  };

  userSchema.statics.findUsersWithPagination = function(options, callback) {
    var sort = options.sort || {status: 1, username: 1, createdAt: 1};

    this.paginate({}, { page: options.page || 1, limit: PAGE_ITEMS }, function(err, paginatedResults, pageCount, itemCount) {
      if (err) {
        debug('Error on pagination:', err);
        return callback(err, null);
      }

      return callback(err, paginatedResults, pageCount, itemCount);
    }, { sortBy : sort });
  };

  userSchema.statics.findUserByUsername = function(username) {
    var User = this;
    return new Promise(function(resolve, reject) {
      User.findOne({username: username}, function (err, userData) {
        if (err) {
          return reject(err);
        }

        return resolve(userData);
      });
    });
  };

  userSchema.statics.findUserByApiToken = function(apiToken) {
    var self = this;

    return new Promise(function(resolve, reject) {
      self.findOne({apiToken: apiToken}, function (err, userData) {
        if (err) {
          return reject(err);
        } else {
          return resolve(userData);
        }
      });
    });
  };

  userSchema.statics.findUserByFacebookId = function(fbId, callback) {
    this.findOne({userId: fbId}, function (err, userData) {
      callback(err, userData);
    });
  };

  userSchema.statics.findUserByGoogleId = function(googleId, callback) {
    this.findOne({googleId: googleId}, function (err, userData) {
      callback(err, userData);
    });
  };

  userSchema.statics.findUserByEmailAndPassword = function(email, password, callback) {
    var hashedPassword = generatePassword(password);
    this.findOne({email: email, password: hashedPassword}, function (err, userData) {
      callback(err, userData);
    });
  };

  userSchema.statics.isRegisterableUsername = function(username, callback) {
    var User = this;
    var usernameUsable = true;

    this.findOne({username: username}, function (err, userData) {
      if (userData) {
        usernameUsable = false;
      }
      return callback(usernameUsable);
    });
  };

  userSchema.statics.isRegisterable = function(email, username, callback) {
    var User = this;
    var emailUsable = true;
    var usernameUsable = true;

    // username check
    this.findOne({username: username}, function (err, userData) {
      if (userData) {
        usernameUsable = false;
      }

      // email check
      User.findOne({email: email}, function (err, userData) {
        if (userData) {
          emailUsable = false;
        }

        if (!emailUsable || !usernameUsable) {
          return callback(false, {email: emailUsable, username: usernameUsable});
        }

        return callback(true, {});
      });
    });
  };

  userSchema.statics.removeCompletelyById = function(id, callback) {
    var User = this;
    User.findById(id, function (err, userData) {
      if (!userData) {
        return callback(err, null);
      }

      debug('Removing user:', userData);
      // 物理削除可能なのは、招待中ユーザーのみ
      // 利用を一度開始したユーザーは論理削除のみ可能
      if (userData.status !== STATUS_INVITED) {
        return callback(new Error('Cannot remove completely the user whoes status is not INVITED'), null);
      }

      userData.remove(function(err) {
        if (err) {
          return callback(err, null);
        }

        return callback(null, 1);
      });
    });
  };

  userSchema.statics.createUsersByInvitation = function(emailList, toSendEmail, callback) {
    var User = this
      , createdUserList = []
      , config = crowi.getConfig()
      , mailer = crowi.getMailer()
      ;

    if (!Array.isArray(emailList)) {
      debug('emailList is not array');
    }

    async.each(
      emailList,
      function(email, next) {
        var newUser = new User()
          ,password;

        email = email.trim();

        // email check
        // TODO: 削除済みはチェック対象から外そう〜
        User.findOne({email: email}, function (err, userData) {
          // The user is exists
          if (userData) {
            createdUserList.push({
              email: email,
              password: null,
              user: null,
            });

            return next();
          }

          password = Math.random().toString(36).slice(-16);

          newUser.email = email;
          newUser.setPassword(password);
          newUser.createdAt = Date.now();
          newUser.status = STATUS_INVITED;

          newUser.save(function(err, userData) {
            if (err) {
              createdUserList.push({
                email: email,
                password: null,
                user: null,
              });
              debug('save failed!! ', email);
            } else {
              createdUserList.push({
                email: email,
                password: password,
                user: userData,
              });
              debug('saved!', email);
            }

            next();
          });
        });
      },
      function(err) {
        if (err) {
          debug('error occured while iterate email list');
        }

        if (toSendEmail) {
          // TODO: メール送信部分のロジックをサービス化する
          async.each(
            createdUserList,
            function(user, next) {
              if (user.password === null) {
                return next();
              }

              mailer.send({
                  to: user.email,
                  subject: 'Invitation to ' + config.crowi['app:title'],
                  template: 'admin/userInvitation.txt',
                  vars: {
                    email: user.email,
                    password: user.password,
                    url: config.crowi['app:url'],
                    appTitle: config.crowi['app:title'],
                  }
                },
                function (err, s) {
                  debug('completed to send email: ', err, s);
                  next();
                }
              );
            },
            function(err) {
              debug('Sending invitation email completed.', err);
            }
          );
        }

        debug('createdUserList!!! ', createdUserList);
        return callback(null, createdUserList);
      }
    );
  };

  userSchema.statics.createUserByEmailAndPassword = function(name, username, email, password, callback) {
    var User = this
      , newUser = new User();

    newUser.name = name;
    newUser.username = username;
    newUser.email = email;
    newUser.setPassword(password);
    newUser.createdAt = Date.now();
    newUser.status = decideUserStatusOnRegistration();

    newUser.save(function(err, userData) {
      if (userData.status == STATUS_ACTIVE) {
        userEvent.emit('activated', userData);
      }
      return callback(err, userData);
    });
  };

  userSchema.statics.createUserByFacebook = function(fbUserInfo, callback) {
    var User = this
      , newUser = new User();

    newUser.userId = fbUserInfo.id;
    newUser.image = '//graph.facebook.com/' + fbUserInfo.id + '/picture?size=square';
    newUser.name = fbUserInfo.name || '';
    newUser.username = fbUserInfo.username || '';
    newUser.email = fbUserInfo.email || '';
    newUser.createdAt = Date.now();
    newUser.status = decideUserStatusOnRegistration();

    newUser.save(function(err, userData) {
      if (userData.status == STATUS_ACTIVE) {
        userEvent.emit('activated', userData);
      }
      return callback(err, userData);
    });
  };


  userSchema.statics.createUserPictureFilePath = function(user, name) {
    var ext = '.' + name.match(/(.*)(?:\.([^.]+$))/)[2];

    return 'user/' + user._id + ext;
  };

  userSchema.statics.getUsernameByPath = function(path) {
    var username = null;
    if (m = path.match(/^\/user\/([^\/]+)\/?/)) {
      username = m[1];
    }

    return username;
  };


  userSchema.statics.STATUS_REGISTERED = STATUS_REGISTERED;
  userSchema.statics.STATUS_ACTIVE = STATUS_ACTIVE;
  userSchema.statics.STATUS_SUSPENDED = STATUS_SUSPENDED;
  userSchema.statics.STATUS_DELETED = STATUS_DELETED;
  userSchema.statics.STATUS_INVITED = STATUS_INVITED;
  userSchema.statics.USER_PUBLIC_FIELDS = USER_PUBLIC_FIELDS;

  return mongoose.model('User', userSchema);
};