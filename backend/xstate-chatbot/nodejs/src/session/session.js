class Session {
  constructor(user) {
    this.user = user;
    this.userId = user.userId;
  }

  static create(user) {
    return new Session(user);
  }
}

module.exports = Session;
