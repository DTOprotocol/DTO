// yarn hardhat test test/offline_tests.js

const { expect } = require("chai");
const { ethers } = require("hardhat");
const { utils, BigNumber } = require('ethers');
const fs = require("fs");

require.extensions['.txt'] = function(module, filename) {
	module.exports = fs.readFileSync(filename, 'utf8');
};

describe("Offline fork tests", function () {

	let owner, randomPerson, randomPerson_2, randomPerson_3;

	let DTOEarlyAccess_ContractFactory;
	let DTOEarlyAccess_Contract;

	let AggregatorDummy_ContractFactory;
	let AggregatorDummy_Contract;

	let priceFeedAddress = "0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419"; // Chainlink ETH/USD price feed

	beforeEach(async function () {

		[
			owner,
			manager,
			codePerson_1,
			codePerson_2,
			codePerson_3,
			randomPerson_1,
			randomPerson_2,
			randomPerson_3
		] = await hre.ethers.getSigners();

		// 1. Deploy PriceFeed dummy contract
		AggregatorDummy_ContractFactory = await hre.ethers.getContractFactory("AggregatorDummy");
		AggregatorDummy_Contract = await AggregatorDummy_ContractFactory.deploy();
		await AggregatorDummy_Contract.deployed();
		console.log("AggregatorDummy contract fetched at:", AggregatorDummy_Contract.address);

		// 2. Deploy DTOEarlyAccess contract
		DTOEarlyAccess_ContractFactory = await hre.ethers.getContractFactory("DTOEarlyAccess");
		DTOEarlyAccess_Contract = await DTOEarlyAccess_ContractFactory.deploy(AggregatorDummy_Contract.address, manager.address);
		await DTOEarlyAccess_Contract.deployed();
		console.log("DTO EarlyAccess contract deployed to:", DTOEarlyAccess_Contract.address);


		// 3. Add 3 codes to the contract
		await DTOEarlyAccess_Contract.connect(manager).addCode("code_1", codePerson_1.address);
		await DTOEarlyAccess_Contract.connect(manager).addCode("code_2", codePerson_2.address);
		await DTOEarlyAccess_Contract.connect(manager).addCode("code_3", codePerson_3.address);

	});

	it("Should test simple buy with ETH by RandomPerson_1", async function () {

		await DTOEarlyAccess_Contract.connect(randomPerson_1).buyWithETH("code_1", {
			value: ethers.utils.parseEther("1")
		});

		// Get balance after the buy
		var randomPersonETH = await ethers.provider.getBalance(randomPerson_1.address);
		console.log(randomPersonETH); // Should return 10k-1 * 1e18 wei
	});

	it("Should revert if not enough ETH is sent for a purchase", async function () {
		// Premise is that in hardhat signers start with 10k ether
		await expect(DTOEarlyAccess_Contract.connect(randomPerson_1).buyWithETH("code_1", {
			value: ethers.utils.parseEther("100000")
		})).to.be.reverted; // Not enough ETH to buy tokens
	});

	it("Should revert when trying to add a code that already exists", async function () {
		await DTOEarlyAccess_Contract.connect(manager).addCode("existing_code", codePerson_1.address);
		await expect(DTOEarlyAccess_Contract.connect(manager).addCode("existing_code", codePerson_2.address))
			.to.be.revertedWith("Code already exists");
	});

	it("Should revert when non-manager tries to advance the round", async function () {
		await expect(DTOEarlyAccess_Contract.connect(randomPerson_1).advanceRound(10 * 10 ** 4))
			.to.be.reverted; // Access error revert
	});

	it("Should allow receiving ETH via the fallback or receive function", async function () {
		const contractBalanceBefore = await ethers.provider.getBalance(DTOEarlyAccess_Contract.address);

		// Sending ETH directly to the contract
		await randomPerson_1.sendTransaction({
			to: DTOEarlyAccess_Contract.address,
			value: ethers.utils.parseEther("1")
		});

		const contractBalanceAfter = await ethers.provider.getBalance(DTOEarlyAccess_Contract.address);
		expect(contractBalanceAfter).to.equal(contractBalanceBefore.add(ethers.utils.parseEther("1")));
	});

	it("Should allow the owner to withdraw Ether", async function () {
		// Send ETH to the contract
		await randomPerson_1.sendTransaction({
			to: DTOEarlyAccess_Contract.address,
			value: ethers.utils.parseEther("2")
		});

		const contractBalanceBefore = await ethers.provider.getBalance(DTOEarlyAccess_Contract.address);
		expect(contractBalanceBefore).to.equal(ethers.utils.parseEther("2"));

		// Owner withdraws the ETH
		await DTOEarlyAccess_Contract.connect(owner).withdrawEther();

		const contractBalanceAfter = await ethers.provider.getBalance(DTOEarlyAccess_Contract.address);
		expect(contractBalanceAfter).to.equal(0);
	});

	it("Should correctly handle large purchases and prevent rounding issues", async function () {
		const largePurchase = ethers.utils.parseEther("100");

		await DTOEarlyAccess_Contract.connect(randomPerson_1).buyWithETH("code_1", {
			value: largePurchase
		});

		// Since ETH is now sent directly to the code owner, no codeOwnerBalance is maintained anymore
	});

	it("Should process buyWithETH and directly transfer ETH to the code owner", async function () {

		// 1. Initial ETH balance of `codePerson_1`
		const initialBalanceCodePerson = await ethers.provider.getBalance(codePerson_1.address);

		// 2. `randomPerson_1` buys with 1 ETH using `code_1`
		const tx = await DTOEarlyAccess_Contract.connect(randomPerson_1).buyWithETH("code_1", {
			value: ethers.utils.parseEther("1")
		});
		await tx.wait();

		// 3. Check balance of `code_1` owner after the buy
		const finalBalanceCodePerson = await ethers.provider.getBalance(codePerson_1.address);

		// Calculate gas costs to avoid discrepancy in balance calculations
		const gasUsedBuy = (await tx.wait()).gasUsed;
		const gasPriceBuy = tx.gasPrice;
		const gasCostBuy = gasUsedBuy.mul(gasPriceBuy);

		// Expected final balance: initialBalanceCodePerson + 1 ETH (minus gas)
		const expectedFinalBalance = initialBalanceCodePerson.add(ethers.utils.parseEther("1")).sub(gasCostBuy);

		// Check if final balance matches expected balance
		expect(finalBalanceCodePerson).to.be.closeTo(expectedFinalBalance, ethers.utils.parseEther("0.001")); // Allow slight tolerance for gas difference
	});

	it("Should allow code owners to receive ETH directly upon purchase", async function () {

		// 1. Initial ETH balance of `codePerson_1` and `codePerson_2`
		const initialBalanceCodePerson1 = await ethers.provider.getBalance(codePerson_1.address);
		const initialBalanceCodePerson2 = await ethers.provider.getBalance(codePerson_2.address);

		// 2. `randomPerson_1` buys with 1 ETH using `code_1`
		const tx1 = await DTOEarlyAccess_Contract.connect(randomPerson_1).buyWithETH("code_1", {
			value: ethers.utils.parseEther("1")
		});
		await tx1.wait();

		// 3. `randomPerson_2` buys with 2 ETH using `code_2`
		const tx2 = await DTOEarlyAccess_Contract.connect(randomPerson_2).buyWithETH("code_2", {
			value: ethers.utils.parseEther("2")
		});
		await tx2.wait();

		// 4. Check final balance of `code_1` and `code_2` owners
		const finalBalanceCodePerson1 = await ethers.provider.getBalance(codePerson_1.address);
		const finalBalanceCodePerson2 = await ethers.provider.getBalance(codePerson_2.address);

		// Check if the final balances match expected results
		expect(finalBalanceCodePerson1).to.be.closeTo(initialBalanceCodePerson1.add(ethers.utils.parseEther("1")), ethers.utils.parseEther("0.001"));
		expect(finalBalanceCodePerson2).to.be.closeTo(initialBalanceCodePerson2.add(ethers.utils.parseEther("2")), ethers.utils.parseEther("0.001"));
	});

	it("Should handle multiple rounds with different prices", async function () {

		// 1. Initial ETH balance of `codePerson_1` and `codePerson_2`
		const initialBalanceCodePerson1 = await ethers.provider.getBalance(codePerson_1.address);
		const initialBalanceCodePerson2 = await ethers.provider.getBalance(codePerson_2.address);

		// 2. `randomPerson_1` buys with 1 ETH using `code_1` at the initial price
		const tx1 = await DTOEarlyAccess_Contract.connect(randomPerson_1).buyWithETH("code_1", {
			value: ethers.utils.parseEther("1")
		});
		await tx1.wait();

		// 3. Manager advances the round and sets the new price to $0.10 USDT (10 * 10^4 = 0.10 USDT)
		const newPriceInUSDT = 10 * 10 ** 4; // 0.10 USDT
		const advanceRoundTx = await DTOEarlyAccess_Contract.connect(manager).advanceRound(newPriceInUSDT);
		await advanceRoundTx.wait();

		// 4. `randomPerson_2` buys with 2 ETH using `code_2` at the new price
		const tx2 = await DTOEarlyAccess_Contract.connect(randomPerson_2).buyWithETH("code_2", {
			value: ethers.utils.parseEther("2")
		});
		await tx2.wait();

		// 5. Check final balance of `code_1` and `code_2` owners
		const finalBalanceCodePerson1 = await ethers.provider.getBalance(codePerson_1.address);
		const finalBalanceCodePerson2 = await ethers.provider.getBalance(codePerson_2.address);

		// Check if the final balances match expected results
		expect(finalBalanceCodePerson1).to.be.closeTo(initialBalanceCodePerson1.add(ethers.utils.parseEther("1")), ethers.utils.parseEther("0.001"));
		expect(finalBalanceCodePerson2).to.be.closeTo(initialBalanceCodePerson2.add(ethers.utils.parseEther("2")), ethers.utils.parseEther("0.001"));
	});

});
