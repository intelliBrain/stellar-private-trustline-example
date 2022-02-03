require('dotenv').config({})
import * as fs from 'fs'
import * as path from 'path'
import 'isomorphic-fetch'
import * as StellarSdk from 'stellar-sdk'

interface AddOperationDelegate {
  (txBuilder: StellarSdk.TransactionBuilder): void;
}

interface LoadKeyPairResult {
  isNew: boolean;
  keyPair: StellarSdk.Keypair;
}

interface InitAccountResult {
  keyPair: StellarSdk.Keypair;
  account: StellarSdk.AccountResponse;
}

interface CreateAccountResult {
  keyPair: StellarSdk.Keypair;
  account: StellarSdk.AccountResponse;
}


export const SECRET_FOLDER_NAME = 'secrets'
export const ISSUERS_KEY_FILE_NAME = 'issuer.key'
export const DISTRIBUTOR_KEY_FILE_NAME = 'dist.key'
export const WALLET_KEY_FILE_NAME = 'wallet.key'

/**
 * Create folder for store
 * key file
 */
 if (!fs.existsSync(path.join(__dirname, SECRET_FOLDER_NAME))) {
  fs.mkdirSync(path.join(__dirname, SECRET_FOLDER_NAME))
}

const numAccountWallets = 5;

const secretFolderPath = path.join(__dirname, SECRET_FOLDER_NAME);
const issuerSecretFilePath = path.join(secretFolderPath, `/${ISSUERS_KEY_FILE_NAME}`);
const distributorSecretFilePath = path.join(secretFolderPath, `/${DISTRIBUTOR_KEY_FILE_NAME}`);
const walletSecretFilePath = path.join(secretFolderPath, `/${WALLET_KEY_FILE_NAME}`);


StellarSdk.Networks.TESTNET;
const server = new StellarSdk.Server('https://horizon-testnet.stellar.org')

async function run() {
  const { ASSET_NAME } = process.env
  if (ASSET_NAME) {
    const issuerInitResult = await initAccount('issuer', issuerSecretFilePath, server);
    const distributorInitResult = await initAccount('distributor', distributorSecretFilePath, server);
    const walletInitResult = await initAccount('wallet', walletSecretFilePath, server);

    const issuer = issuerInitResult.account;
    const issuerKey = issuerInitResult.keyPair;
    const distributor = distributorInitResult.account;
    const distributorKey = distributorInitResult.keyPair;
    const wallet = walletInitResult.account;
    const walletKey = walletInitResult.keyPair;

    console.log(`[main] issuer.....:        id = ${issuer.id}`);
    console.log(`[main] issuer.....: publicKey = ${issuerKey.publicKey()}`);
    console.log('');
    console.log(`[main] distributor:        id = ${distributor.id}`);
    console.log(`[main] distributor: publicKey = ${distributorKey.publicKey()}`);
    console.log('');
    console.log(`[main] wallet.....:        id = ${wallet.id}`);
    console.log(`[main] wallet.....: publicKey = ${walletKey.publicKey()}`);
    console.log('');

      const AppAsset = new StellarSdk.Asset(ASSET_NAME, issuerKey.publicKey())

    //********************************************************
    // Lock our asset by setting an option
    // AUTHORIZATION REQUIRED flag
    // to issuer account
    //********************************************************
    await createSignAndSubmitTransaction(
      issuer, 
      issuerKey, 
      `[main] issuer: setOptions(setFlags=AuthRequiredFlag)`, 
      (txBuilder) => {
        txBuilder.addOperation(
          StellarSdk.Operation.setOptions({
            setFlags: StellarSdk.AuthRequiredFlag
            // clearFlags: StellarSdk.AuthRequiredFlag
          })
        );
      }
    );


    //********************************************************
    // Change distributor trustline to trust issuer
    //********************************************************
    await createSignAndSubmitTransaction(
      distributor, 
      distributorKey, 
      `[main] distributor: changeTrust(asset {code: '${AppAsset.code}', issuer: 'issuer'})`, 
      (txBuilder) => {
        txBuilder.addOperation(
          StellarSdk.Operation.changeTrust({
            asset: AppAsset
          })
        );
      }
    );


    //********************************************************
    // Change wallet trustline to trust issuer
    //********************************************************
    await createSignAndSubmitTransaction(
      wallet, 
      walletKey, 
      `[main] wallet: changeTrust(asset {code: '${AppAsset.code}', issuer: 'issuer'})`, 
      (txBuilder) => {
        txBuilder.addOperation(
          StellarSdk.Operation.changeTrust({
            asset: AppAsset
          })
        );
      }
    );


    //********************************************************
    // Allow distributor to hold our custom asset
    //********************************************************
    await createSignAndSubmitTransaction(
      issuer, 
      issuerKey, 
      `[main] issuer: allowTrust (assetCode='${ASSET_NAME}', authorize = true, trustor = 'distributor')`,
      (txBuilder) => {
        txBuilder.addOperation(
          StellarSdk.Operation.allowTrust({
            assetCode: ASSET_NAME,
            authorize: true,
            trustor: distributor.id
          })
        );
      }
    );


    //********************************************************
    // Issuing Asset to distributor
    //********************************************************
    await createSignAndSubmitTransaction(
      issuer, 
      issuerKey, 
      `[main] issuer: payment(asset {code: '${AppAsset.code}', issuer: 'issuer'}, amount = '1000000', destination = 'distributor')`, 
      (txBuilder) => {
        txBuilder.addOperation(
          StellarSdk.Operation.payment({
            asset: AppAsset,
            amount: '1000000',
            destination: distributor.id
          })
        );
      }
    );

    await dumpAssetBalances('issuer', issuerKey);
    await dumpAssetBalances('distributor', distributorKey);
    await dumpAssetBalances('wallet', walletKey);

    //********************************************************
    // Customer init wallet and account
    // and then try to add trustline without
    // authorization
    //********************************************************
    // const wallet = await createWalllet(server)
    // if (!wallet) {
    //   throw new Error('[main] wallet is unavaliable => abort')
    // }

    
    //const walletKey = await getWalletKey()
    //console.log(`[main] wallet.id=${wallet.id}, publicKey=${walletKey.publicKey()}`);


    //********************************************************
    // Try to send asset to customer
    // Distributor will fail at the first attempt to send
    // some asset to wallet
    //********************************************************
    // await createSignAndSubmitTransaction(
    //   distributor, 
    //   distributorKey, 
    //   `[main] distributor: payment(asset {code: '${AppAsset.code}', issuer: 'issuer'}, amount = '20', destination = 'wallet')`, 
    //   (txBuilder) => {
    //     txBuilder.addOperation(
    //       StellarSdk.Operation.payment({
    //         asset: AppAsset,
    //         amount: '20',
    //         destination: wallet.id
    //       })
    //     );
    //   }
    // );


    //********************************************************
    // Allow wallet to hold our custom asset
    //********************************************************
    await createSignAndSubmitTransaction(
      issuer, 
      issuerKey, 
      `[main] issuer: allowTrust(assetCode = '${AppAsset.code}', authorize = true, trustor = 'wallet')`, 
      (txBuilder) => {
        txBuilder.addOperation(
          StellarSdk.Operation.allowTrust({
            assetCode: AppAsset.code,
            authorize: true,
            trustor: wallet.id
          })
        );
      }
    );


    //********************************************************
    // and then ask distributor to
    // try to send Asset to wallet again
    //********************************************************
    await createSignAndSubmitTransaction(
      distributor, 
      distributorKey, 
      `[main] distributor: payment(asset = {code: '${AppAsset.code}', issuer: '${AppAsset.issuer}'}, amount = '20', destination = 'wallet')`, 
      (txBuilder) => {
        txBuilder.addOperation(
          StellarSdk.Operation.payment({
            asset: AppAsset,
            amount: '20',
            destination: wallet.id
          })
        );
      }
    );


    await dumpAssetBalances('issuer', issuerKey);
    await dumpAssetBalances('distributor', distributorKey);
    await dumpAssetBalances('wallet', walletKey);
  } else {
    console.log('[main] Asset name not found (process.env.ASSET_NAME)')
  }

  console.log('BYE BYE');
}

export async function dumpAssetBalances (accountName: string, keyPair: StellarSdk.Keypair): Promise<StellarSdk.AccountResponse> {
  const account = await server.loadAccount(keyPair.publicKey());

  console.log("");
  console.log('============================================================================================');
  console.log(`[main] ${accountName} ${keyPair.publicKey()} asset balances:`);
  account.balances.forEach((asset) => {
    console.log(asset);
  });
  console.log('============================================================================================');
  console.log("");

  return account;
}

export async function createSignAndSubmitTransaction (sourceAccount: StellarSdk.Account, signerKey: StellarSdk.Keypair, title: string, addOperationDelegate: AddOperationDelegate) {
  const txBuilder = new StellarSdk.TransactionBuilder(sourceAccount, {
  fee: "100",
  networkPassphrase: StellarSdk.Networks.TESTNET
  });

  addOperationDelegate(txBuilder);

  txBuilder.setTimeout(100);
  const transaction = txBuilder.build();

  // sign transaction
  transaction.sign(signerKey);

  // submit to server
  console.log(title);
  
  try {
    await server.submitTransaction(transaction);
  } catch (e) {
    console.log(`${title}: Exception occured for signer: ${signerKey.publicKey()}`);
    console.dir(e)
  }
};

export function loadKeyPair(accountName: string, secretFilePath: string): LoadKeyPairResult {
  var fileExists = fs.existsSync(secretFilePath);

  let isNew = false;
  let keyPair: StellarSdk.Keypair;
  if (!fileExists) {
    keyPair = StellarSdk.Keypair.random();
    fs.writeFileSync(secretFilePath, keyPair.secret());
    isNew = true;
  } else {
    const accountSecret = fs.readFileSync(secretFilePath).toString();
    keyPair = StellarSdk.Keypair.fromSecret(accountSecret);
  }

  return {
    isNew: isNew,
    keyPair: keyPair,
  };
}

export async function initAccount(accountName: string, secretFilePath: string, server: StellarSdk.Server): Promise<InitAccountResult> {
  var loadKeyResult = loadKeyPair(accountName, secretFilePath);

  if (loadKeyResult.isNew) {
     if (process.env.NODE_ENV === 'development') {
      await fetch(`https://friendbot.stellar.org/?addr=${loadKeyResult.keyPair.publicKey()}`, {});
    }
  }

  const account = await dumpAssetBalances(accountName, loadKeyResult.keyPair);

  return {
    keyPair: loadKeyResult.keyPair,
    account: account,
  };
}

run();
