
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
  /* Description: Unit test cases for api/twitter-api                        */
  /*              'getQueueWaitTimes' requests                               */
  /***************************************************************************/

  // Required libraries
  var Assert = require('assert');
  var Request = require('supertest');
  var Should = require('should');

  // Required local modules
  var Common = require('../../../data/common');

  module.exports = function(app) {

    var agent = Request.agent(app);

    // Username does not exist in session
    it('should return status 401 - invalid username in session - getQueueWaitTimes()', function(done) {
      this.timeout(Common.TIMEOUT);

      agent
        .get('/twitter-api/getQueueWaitTimes')
        .expect(401)
        .end(function(error, response) {
          Should.not.exist(error);
          done();
        });
    });

    // Valid
    it('should return status 200 - getQueueWaitTimes()', function(done) {
      this.timeout(Common.TIMEOUT);

      agent
        .post('/user-api/login')
        .send(Common.LOGIN_USER)
        .expect(200)
        .end(function(error, response) {
          Should.not.exist(error);

          agent
            .get('/twitter-api/getQueueWaitTimes')
            .expect(200)
            .end(function(error, response) {
              Should.not.exist(error);
              Should.exist(response.body.waitTimes);
              Assert.strictEqual(response.body.waitTimes.length, 2);
              Assert.strictEqual(response.body.waitTimes[0], -1);
              Assert.strictEqual(response.body.waitTimes[1], -1);
              done();
            });
        });
    });
  };
