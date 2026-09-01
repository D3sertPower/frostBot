module.exports = {
  name: 'sendoffer',
  aliases: ['s','send','soffer','enviaroferta'],
  args: ['(friend name) or (friend steam id)'],
  description: 'Send a offer to someone',
  run () {
    if (!arguments[2]) {
     return 'You didn\'t who you\'re sending the offer to'
    }
    else {
    var target = arguments[1]

    }
  }
}