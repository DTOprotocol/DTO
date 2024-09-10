// SPDX-License-Identifier: MIT

pragma solidity ^0.8.4;

contract AggregatorDummy {
    
	function latestRoundData()
		public
		view
		returns (
		  uint80 roundId,
		  int256 answer,
		  uint256 startedAt,
		  uint256 updatedAt,
		  uint80 answeredInRound
		)
	  {
		  
		// Dummy data
		return 
		(
		  110680464442257332420,
		  240026718800, // ETH price ~2400 USD
		  1725591335,
		  1725591335,
		  110680464442257332420
		);
		
	  }

}
