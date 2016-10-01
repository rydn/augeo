
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
  /* Description: Controller for the application                             */
  /***************************************************************************/

  // Reminder: Update controller/index.js when controller params are modified
  module.exports = function($scope, $state, $window, UserClientService, ProfileController, InterfaceClientService) {

    $scope.layoutNavbar = 'hidden';
    $scope.isWelcomeModalViewed = false;

    $scope.$on('$stateChangeStart', function(event, toState, toParams, fromState, fromParams) {

      UserClientService.getCurrentUser(function(user, status) {

        // Set global User object
        $scope.User = user;
        UserClientService.setAuthentications($scope.User);

        if(toState.name != 'logout') {
          if(user.firstName) {
            $scope.layoutNavbar = 'initial';
          } else {
            $scope.layoutNavbar = 'hidden';
          }
        } else {
          $scope.layoutNavbar = 'hidden';
        }
        if($scope.User.username && toState.name != 'signupError') {
          // Display welcome popup if user has no authentications and has not viewed it within this session
          if (!$scope.User.hasAuthentications && !$scope.isWelcomeModalViewed) {
            $scope.isWelcomeModalViewed = true;
            $scope.aboutModalHeading = 'Welcome to Augeo!'
            showAboutModal();
          }
        }

      });
    });

    $scope.removeErrorMessage = '';
    $scope.removeUser = function(password) {
      UserClientService.removeUser(password, function(data, status) {
        if(status == 200) {
          $state.go('login');
          $('#delete-modal').modal('toggle');
        } else {
          $scope.removeErrorMessage = data;
        }
      });
    };

    $scope.showAboutModal = function() {
      $scope.aboutModalHeading = 'About';
      showAboutModal();
    }

    $scope.showProfile = function() {
      ProfileController.setTargetUser($scope.User);
      showProfileModal();
    };

    $scope.submitGithubAuthentication = function() {

      // Authenticate user with Github
      InterfaceClientService.getAuthenticationData('github-api',function(authData) {

        if(authData.clientId) {
          $window.location.href = 'https://github.com/login/oauth/authorize?client_id=' + authData.clientId +
            '&redirect_url=' + authData.redirectUrl + '&scope=' + authData.scope + '&state=' + authData.state;
        } else {
          $state.go('login');
          $scope.loginMessage = 'Failed to Authenticate with Github'
        }
      });
    };

    $scope.submitTwitterAuthentication = function() {
      // Authenticate user with twitter
      InterfaceClientService.getAuthenticationData('twitter-api',function(authData, authStatus) {

        if(authStatus == 200) {
          // Go to Twitter Authentication page
          $window.location.href ='https://twitter.com/oauth/authenticate?oauth_token=' + authData.token;
        } else {
          $state.go('login');
          $scope.loginMessage = 'Failed to Authenticate with Twitter'
        }
      }); // End authentication
    };
  };
