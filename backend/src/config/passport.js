/**
 * Passport.js Configuration
 * Sets up Google OAuth 2.0 strategy
 */

const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const config = require('./index');

/**
 * Configure Google OAuth Strategy
 */
passport.use(
  new GoogleStrategy(
    {
      clientID: config.google.clientId,
      clientSecret: config.google.clientSecret,
      callbackURL: config.google.callbackUrl,
      scope: ['profile', 'email'], // Only request necessary data (HIPAA compliance)
      proxy: true // Support for reverse proxies
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        // Extract Google profile data
        const googleProfile = {
          id: profile.id,
          email: profile.emails[0].value,
          given_name: profile.name.givenName,
          family_name: profile.name.familyName,
          verified_email: profile.emails[0].verified
        };

        // Return profile to be processed in route handler
        // We don't store access/refresh tokens (not needed for MVP)
        return done(null, googleProfile);
      } catch (error) {
        console.error('Google OAuth error:', error);
        return done(error, null);
      }
    }
  )
);

/**
 * Serialize user for session
 * Store minimal data in session cookie
 */
passport.serializeUser((user, done) => {
  done(null, user);
});

/**
 * Deserialize user from session
 */
passport.deserializeUser((user, done) => {
  done(null, user);
});

module.exports = passport;
