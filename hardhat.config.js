require("@nomiclabs/hardhat-waffle");
require("@nomiclabs/hardhat-etherscan");

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
 
module.exports = {
	defaultNetwork: "hardhat",
	solidity: {
        version: "0.8.9",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
    },
	networks: {
		hardhat: {
			allowUnlimitedContractSize: true,
			
			gasPrice: 'auto', // ensure gas price is handled dynamically
			gas: 'auto',      // set the gas limit dynamically
			
		}
	}
};
